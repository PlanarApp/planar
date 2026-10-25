import { liveQuery } from 'dexie';
import { ref, type Ref } from 'vue';
import {
  MutatorError,
  createRegistry,
  syncBootstrapSchema,
  syncPullSchema,
  syncPushResponseSchema,
  uuidv7,
  wsServerSchema,
  wsTypingServerSchema,
  type MutatorCtx,
  type MutatorDef,
} from '@planar/shared';
import { PlanarDB, type QueueItem, type ReplicaChange, type Undo } from './db';
import { DexieTx, applyUndo } from './dexie-tx';

export interface StartOpts {
  userId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  WebSocket?: typeof WebSocket;
}
export interface TypingEvent {
  entity: string;
  id: string;
  userId: string;
}
export type SyncStatus = 'idle' | 'bootstrapping' | 'online' | 'offline' | 'error';
export interface MutationErrorInfo {
  id: number;
  name: string;
  code: string;
  message: string;
}
type Change = {
  seq: number;
  entity: string;
  id: string;
  op: 'put' | 'del';
  data?: Record<string, unknown>;
};

class HttpError extends Error {
  constructor(
    public status: number,
    public code = '',
    message = '',
  ) {
    super(message || `HTTP ${status}`);
  }
}
const LOCK = 'planar-sync-leader';
const CHANNEL = 'planar-replica';
const RESET: ReplicaChange = { entity: '*', id: '*', row: null };
export type ReplicaState = 'empty' | 'partial' | 'complete';
/** Таблицы, которые bootstrap пишет вторым этапом (строки не открытого проекта), с полем связи. */
const DEFERRED: Record<string, 'id' | 'taskId'> = {
  tasks: 'id',
  taskAssignees: 'taskId',
  taskLabels: 'taskId',
  checklistItems: 'taskId',
  comments: 'taskId',
  attachments: 'taskId',
  commentReactions: 'taskId', // фактически commentId — см. splitBootstrap
};
const BATCH = 1000;

type Rows = Record<string, unknown>[];

/** Проект, открытый по адресу: /p/:projectId или /t/:key (PLN-12 или uuid задачи). */
function openProject(data: Record<string, Rows>): string | undefined {
  const path = globalThis.location?.pathname ?? '';
  const p = /^\/p\/([^/]+)/.exec(path)?.[1];
  if (p) return data.projects?.some((x) => x.id === p) ? p : undefined;
  const t = /^\/t\/([^/]+)/.exec(path)?.[1];
  if (!t) return undefined;
  const k = /^(.+)-\d+$/.exec(decodeURIComponent(t))?.[1];
  const byKey = k && data.projects?.find((x) => x.key === k)?.id;
  return (byKey || data.tasks?.find((x) => x.id === t)?.projectId || undefined) as
    string | undefined;
}

/** Строки открытого проекта + остальные пачки; без открытого проекта — undefined (пишем всё сразу). */
function splitBootstrap(data: Record<string, Rows>) {
  const pid = openProject(data);
  if (!pid) return undefined;
  const hotTasks = new Set<string>();
  for (const t of data.tasks ?? []) if (t.projectId === pid) hotTasks.add(t.id as string);
  const hotComments = new Set<string>();
  for (const c of data.comments ?? [])
    if (hotTasks.has(c.taskId as string)) hotComments.add(c.id as string);
  const hot: Record<string, Rows> = {};
  const rest: [string, Rows][] = [];
  for (const [name, rows] of Object.entries(data)) {
    const key = DEFERRED[name];
    if (!key) {
      hot[name] = rows;
      continue;
    }
    const isHot =
      name === 'commentReactions'
        ? (r: Record<string, unknown>) => hotComments.has(r.commentId as string)
        : (r: Record<string, unknown>) => hotTasks.has(r[key] as string);
    hot[name] = rows.filter(isHot);
    const other = rows.filter((r) => !isHot(r));
    if (other.length) rest.push([name, other]);
  }
  return { hot, rest };
}
const BACKOFF = (n: number) => Math.min(30_000, 1000 * 2 ** n);

export function createClient(db: PlanarDB) {
  const registry = new Map<string, MutatorDef>();
  const syncState = ref({ status: 'idle' as SyncStatus, pending: 0 });
  const errorCbs = new Set<(e: MutationErrorInfo) => void>();
  const authCbs = new Set<() => void>();
  const replicaCbs = new Set<(b: ReplicaChange[]) => void>();
  const typingCbs = new Set<(e: TypingEvent) => void>();
  const replicaState = ref<ReplicaState>('empty');
  // другие вкладки: те же пачки; db.name — чтобы клиенты разных баз (тесты) не слышали друг друга
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);
  (channel as { unref?: () => void } | null)?.unref?.();
  const fire = (b: ReplicaChange[]) => {
    for (const cb of [...replicaCbs])
      try {
        cb(b);
      } catch (e) {
        console.error(e);
      }
  };
  channel?.addEventListener('message', (ev: MessageEvent) => {
    if (ev.data?.db === db.name && Array.isArray(ev.data.batch)) fire(ev.data.batch);
  });
  /** после коммита: подписчикам этой вкладки и (если не local) остальным вкладкам */
  const emit = (b: ReplicaChange[], local = false) => {
    if (!b.length) return;
    fire(b);
    if (!local) channel?.postMessage({ db: db.name, batch: b });
  };

  let opts: StartOpts | null = null;
  let gen = 0; // номер запуска: отсекает хвосты прошлых startSync
  let leading = false;
  let clientId = '';
  let cursor: number | undefined;
  let pushedUpTo = 0;
  let failures = 0;
  let wsFailures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let wsTimer: ReturnType<typeof setTimeout> | undefined;
  let ws: WebSocket | null = null;
  let releaseLock: (() => void) | null = null;
  let leaderLock: Promise<unknown> | null = null;
  let unsub: (() => void) | null = null;
  let onlineHandler: (() => void) | null = null;
  let running: Promise<void> | null = null;
  let again = false;
  let abort = new AbortController();
  let wsStable: ReturnType<typeof setTimeout> | undefined;

  const setStatus = (s: SyncStatus) => (syncState.value = { ...syncState.value, status: s });
  const meta = async (key: 'clientId' | 'userId' | 'cursor' | 'lastMutationId') =>
    (await db._meta.get(key))?.value;

  function registerMutators(defs: MutatorDef[]) {
    createRegistry([...registry.values(), ...defs]); // дубликат имени → Error
    for (const d of defs) registry.set(d.name, d);
  }

  async function mutate(name: string, input: unknown): Promise<void> {
    const def = registry.get(name);
    if (!def) throw new MutatorError('invalid_args', `неизвестный мутатор: ${name}`);
    // аргументы — JSON по C-sync; реактивные Proxy Vue IndexedDB не клонирует (DataCloneError)
    const args: unknown = input === undefined ? undefined : JSON.parse(JSON.stringify(input));
    const parsed = def.args.safeParse(args);
    if (!parsed.success) throw new MutatorError('invalid_args', parsed.error.message);
    if (!opts) throw new Error('sync не запущен: вызовите startSync');
    const createdAt = new Date().toISOString();
    const undo: Undo[] = [];
    const changes: ReplicaChange[] = [];
    await db.transaction('rw', db.tables, async () => {
      changes.length = 0;
      await def.run(new DexieTx(db, undo, changes), parsed.data, ctx(createdAt));
      await db._queue.add({ name, args, createdAt, undo });
    });
    emit(changes);
    // pending и отправку подхватывает подписка на _queue из startSync (в том числе из других вкладок)
  }

  const ctx = (now: string): MutatorCtx => ({ userId: opts!.userId, now, server: false });
  const refreshPending = async () => {
    syncState.value = { ...syncState.value, pending: await db._queue.count() };
  };

  /**
   * Серверное состояние + rebase очереди в одной транзакции: откат оптимистичных записей,
   * применение серверных, выброс подтверждённых/отклонённых, повтор оставшихся.
   */
  async function applyServer(p: {
    bootstrap?: Record<string, Record<string, unknown>[]>;
    changes?: Change[];
    cursor?: number;
    lastMutationId?: number;
    drop?: Set<number>;
  }): Promise<void> {
    const g = gen;
    const changes: ReplicaChange[] = [];
    let rest: [string, Rows][] = [];
    await db.transaction('rw', db.tables, async () => {
      changes.length = 0;
      rest = [];
      const queue = await db._queue.orderBy('id').toArray();
      if (p.bootstrap) {
        changes.push(RESET);
        // shortcut: с неподтверждённой очередью пишем всё сразу — rebase не должен гоняться с фоновой записью
        const split = queue.length ? undefined : splitBootstrap(p.bootstrap);
        const data = split?.hot ?? p.bootstrap;
        rest = split?.rest ?? [];
        for (const t of db.entityTables()) {
          await t.clear();
          const rows = data[t.name] ?? [];
          for (let i = 0; i < rows.length; i += 2000) await t.bulkPut(rows.slice(i, i + 2000));
        }
      } else {
        for (const q of queue.slice().reverse()) await applyUndo(db, q.undo ?? [], changes);
        for (const c of p.changes ?? []) {
          if (!db.tables.some((t) => t.name === c.entity)) continue;
          if (c.op === 'put') await db.table(c.entity).put(c.data);
          else await db.table(c.entity).delete(c.id);
          changes.push({
            entity: c.entity,
            id: c.id,
            row: c.op === 'put' ? (c.data ?? null) : null,
          });
        }
      }
      for (const q of queue) {
        if (p.drop?.has(q.id!) || q.id! <= (p.lastMutationId ?? 0)) {
          await db._queue.delete(q.id!);
          continue;
        }
        const undo: Undo[] = [];
        try {
          const def = registry.get(q.name);
          if (!def) throw new MutatorError('invalid_args', `неизвестный мутатор: ${q.name}`);
          await def.run(new DexieTx(db, undo, changes), def.args.parse(q.args), ctx(q.createdAt));
          await db._queue.update(q.id!, { undo });
        } catch {
          // не применима к реплике: пропускаем локальный эффект, но оставляем в очереди — судит сервер
          await applyUndo(db, undo, changes);
          await db._queue.update(q.id!, { undo: [] });
        }
      }
      // курсор — только когда реплика целиком на месте: оборвавшийся bootstrap начнётся заново
      if (p.cursor !== undefined && !rest.length)
        await db._meta.put({ key: 'cursor', value: p.cursor });
      if (p.lastMutationId !== undefined)
        await db._meta.put({ key: 'lastMutationId', value: p.lastMutationId });
    });
    if (p.bootstrap) replicaState.value = rest.length ? 'partial' : 'complete';
    emit(changes);
    if (rest.length) {
      // остальные задачи — пачками, отдавая поток отрисовке; события только этой вкладке (в других — один reset в конце)
      for (const [name, rows] of rest)
        for (let i = 0; i < rows.length; i += BATCH) {
          if (g !== gen) return; // остановлено: курсор не записан — bootstrap повторится
          const part = rows.slice(i, i + BATCH);
          await db.table(name).bulkPut(part);
          emit(
            part.map((row) => ({ entity: name, id: row.id as string, row })),
            true,
          );
          await new Promise((r) => setTimeout(r));
        }
      if (g !== gen) return;
      await db._meta.put({ key: 'cursor', value: p.cursor! });
      replicaState.value = 'complete';
      channel?.postMessage({ db: db.name, batch: [RESET] });
    }
    if (p.cursor !== undefined) cursor = p.cursor;
    await refreshPending();
  }

  const emitErrors = (list: MutationErrorInfo[]) => {
    for (const e of list) errorCbs.forEach((cb) => cb(e));
  };

  async function http(path: string, init?: RequestInit): Promise<unknown> {
    const f = opts!.fetch ?? globalThis.fetch.bind(globalThis);
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)]);
    const res = await f((opts!.baseUrl ?? '') + path, { ...init, signal });
    if (!res.ok) {
      // тело ошибки C-http {code, message}: показать причину, а не «HTTP 403»
      const b = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
      throw new HttpError(res.status, b?.code ?? '', b?.message ?? '');
    }
    return res.json();
  }

  async function bootstrap() {
    setStatus('bootstrapping');
    const r = syncBootstrapSchema.parse(await http(`/sync/bootstrap?clientId=${clientId}`));
    await applyServer({ bootstrap: r.data, cursor: r.cursor, lastMutationId: r.lastMutationId });
  }

  async function pull() {
    const r = syncPullSchema.parse(await http(`/sync/pull?cursor=${cursor}&clientId=${clientId}`));
    if (r.reset) return bootstrap();
    await applyServer({ changes: r.changes, cursor: r.cursor, lastMutationId: r.lastMutationId });
  }

  /** true — что-то отправлено */
  async function push(): Promise<boolean> {
    const items = await db._queue.where('id').above(pushedUpTo).limit(100).toArray();
    if (!items.length) return false;
    const body = {
      clientId,
      mutations: items.map((q) => ({ id: q.id!, name: q.name, args: q.args })),
    };
    const r = syncPushResponseSchema.parse(
      await http('/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    pushedUpTo = items[items.length - 1].id!;
    const rejected = new Map<number, { code: string; message: string }>();
    for (const x of r.results) if (!x.ok) rejected.set(x.id, x);
    if (rejected.size) {
      const byId = new Map<number, QueueItem>(items.map((q) => [q.id!, q]));
      await applyServer({ drop: new Set(rejected.keys()) });
      emitErrors([
        ...[...rejected].map(([id, x]) => ({
          id,
          name: byId.get(id)?.name ?? '',
          code: x.code,
          message: x.message,
        })),
      ]);
    }
    return true;
  }

  async function cycle() {
    clearTimeout(retryTimer);
    const g = gen;
    try {
      // сначала push (C-sync: push не зависит от курсора), затем один pull
      const boot = cursor === undefined;
      if (boot) await bootstrap();
      if (g !== gen) return;
      let sent = false;
      while (await push()) sent = true;
      if (!boot || sent) await pull();
      failures = 0;
      setStatus('online');
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        setStatus('error');
        authCbs.forEach((cb) => cb());
        return;
      }
      // таймаут/обрыв fetch (AbortError, TimeoutError) — как сетевая ошибка
      const net =
        e instanceof TypeError ||
        (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) ||
        (e instanceof HttpError && e.status >= 500);
      setStatus(net ? 'offline' : 'error');
      // отказ сервера (не сеть): изменения не уходят — сказать, иначе правки молча копятся в очереди
      if (!net && e instanceof HttpError)
        emitErrors([{ id: 0, name: 'sync', code: e.code || String(e.status), message: e.message }]);
      const g = gen;
      retryTimer = setTimeout(() => g === gen && void kick(), BACKOFF(failures++));
    }
  }

  /** Один цикл pull+push за раз; запросы во время цикла сливаются в повтор. */
  function kick(): Promise<void> {
    if (!leading) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        await cycle();
      } while (again && leading);
    })().finally(() => (running = null));
    return running;
  }

  function connectWs() {
    const g = gen;
    const WS = opts!.WebSocket ?? globalThis.WebSocket;
    if (!WS) return;
    const base = opts!.baseUrl || globalThis.location?.origin || '';
    const s = new WS(base.replace(/^http/, 'ws') + '/ws');
    ws = s;
    s.onopen = () => {
      // устойчивое соединение — открыто ≥ 5 с или пришёл poke; иначе пауза растёт
      wsStable = setTimeout(() => (wsFailures = 0), 5000);
      s.send(JSON.stringify({ t: 'hello', cursor: cursor ?? 0 }));
    };
    s.onmessage = (ev) => {
      let m;
      try {
        const json = JSON.parse(String(ev.data));
        const ty = wsTypingServerSchema.safeParse(json);
        if (ty.success) {
          const { entity, id, userId } = ty.data;
          for (const cb of [...typingCbs]) cb({ entity, id, userId });
          return;
        }
        m = wsServerSchema.safeParse(json);
      } catch {
        return;
      }
      if (m.success) wsFailures = 0;
      if (m.success && m.data.seq > (cursor ?? 0)) void kick();
    };
    s.onclose = (ev) => {
      clearTimeout(wsStable);
      if (g !== gen) return;
      ws = null;
      if (ev.code === 4401) return authCbs.forEach((cb) => cb());
      wsTimer = setTimeout(() => g === gen && connectWs(), BACKOFF(wsFailures++));
    };
  }

  async function lead(g: number) {
    if (g !== gen) return;
    leading = true;
    // тёплый старт не ждёт сеть; холодный — ждёт bootstrap
    if (cursor === undefined) await kick();
    else void kick();
    if (g !== gen) return;
    connectWs();
  }

  async function startSync(o: StartOpts): Promise<void> {
    await stopSync();
    opts = o;
    const g = ++gen;
    await db.open();
    const owner = (await meta('userId')) as string | undefined;
    if (owner !== undefined && owner !== o.userId) await wipe(); // реплика другого пользователя
    await db._meta.put({ key: 'userId', value: o.userId });
    const id = (await meta('clientId')) as string | undefined;
    clientId = id ?? uuidv7();
    if (!id) await db._meta.put({ key: 'clientId', value: clientId });
    cursor = (await meta('cursor')) as number | undefined;
    replicaState.value = cursor === undefined ? 'empty' : 'complete';
    pushedUpTo = 0;
    failures = wsFailures = 0;
    setStatus('idle');
    await refreshPending();
    // все вкладки следят за очередью; ведущая отправляет новое из любой вкладки
    const sub = liveQuery(async () => ({
      n: await db._queue.count(),
      last: (await db._queue.orderBy('id').last())?.id ?? 0,
    })).subscribe(({ n, last }) => {
      syncState.value = { ...syncState.value, pending: n };
      if (leading && last > pushedUpTo) void kick();
    });
    unsub = () => sub.unsubscribe();
    if (typeof window !== 'undefined') {
      onlineHandler = () => void kick();
      window.addEventListener('online', onlineHandler);
    }
    const locks = globalThis.navigator?.locks;
    if (!locks) return lead(g);
    // вкладки: лидер (navigator.locks) ведёт WS/pull/push, остальные только пишут в _queue
    await new Promise<void>((resolve) => {
      const held = new Promise<void>((r) => (releaseLock = r));
      let done!: () => void;
      leaderLock = new Promise<void>((r) => (done = r));
      locks
        .request(LOCK, { ifAvailable: true }, async (lock) => {
          if (lock) {
            await lead(g);
            resolve();
            return held.finally(done);
          }
          done();
          resolve();
          void locks.request(LOCK, async () => {
            if (g !== gen) return;
            await lead(g);
            return held;
          });
        })
        .catch(() => (done(), resolve()));
    });
  }

  async function stopSync(): Promise<void> {
    gen++;
    leading = false;
    clearTimeout(retryTimer);
    clearTimeout(wsTimer);
    clearTimeout(wsStable);
    abort.abort();
    abort = new AbortController();
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
    unsub?.();
    unsub = null;
    if (onlineHandler) window.removeEventListener('online', onlineHandler);
    onlineHandler = null;
    releaseLock?.();
    releaseLock = null;
    await leaderLock; // замок снят до возврата: новый startSync станет лидером
    leaderLock = null;
    await running;
  }

  /** очистка реплики, очереди и _meta; новый clientId */
  async function wipe(): Promise<void> {
    await db.open();
    await db.transaction('rw', db.tables, async () => {
      for (const t of db.tables) await t.clear();
      await db._meta.put({ key: 'clientId', value: uuidv7() });
    });
    cursor = undefined;
    pushedUpTo = 0;
    replicaState.value = 'empty';
    syncState.value = { status: 'idle', pending: 0 };
    emit([RESET]);
  }

  async function clearLocal(): Promise<void> {
    await stopSync();
    await wipe();
  }

  return {
    clearLocal,
    registerMutators,
    mutate,
    startSync,
    stopSync,
    syncState: syncState as Readonly<Ref<{ status: SyncStatus; pending: number }>>,
    /** один цикл pull+push сейчас (для тестов) */
    syncNow: () => kick(),
    replicaState: replicaState as Readonly<Ref<ReplicaState>>,
    onReplicaChange(cb: (batch: ReplicaChange[]) => void) {
      replicaCbs.add(cb);
      return () => void replicaCbs.delete(cb);
    },
    /** «Печатает…» (C-sync v2): WS не открыт — ничего. */
    sendTyping(entity: string, id: string): void {
      try {
        ws?.send(JSON.stringify({ t: 'typing', entity, id }));
      } catch {
        // соединение ещё открывается/закрыто — эфемерное сообщение не нужно
      }
    },
    onTyping(cb: (e: TypingEvent) => void) {
      typingCbs.add(cb);
      return () => void typingCbs.delete(cb);
    },
    onMutationError(cb: (e: MutationErrorInfo) => void) {
      errorCbs.add(cb);
      return () => void errorCbs.delete(cb);
    },
    onUnauthorized(cb: () => void) {
      authCbs.add(cb);
      return () => void authCbs.delete(cb);
    },
  };
}
