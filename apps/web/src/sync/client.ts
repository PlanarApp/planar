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
  type MutatorCtx,
  type MutatorDef,
} from '@planar/shared';
import { PlanarDB, type QueueItem, type Undo } from './db';
import { DexieTx, applyUndo } from './dexie-tx';

export interface StartOpts {
  userId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  WebSocket?: typeof WebSocket;
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
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}
const LOCK = 'planar-sync-leader';
const BACKOFF = (n: number) => Math.min(30_000, 1000 * 2 ** n);

export function createClient(db: PlanarDB) {
  const registry = new Map<string, MutatorDef>();
  const syncState = ref({ status: 'idle' as SyncStatus, pending: 0 });
  const errorCbs = new Set<(e: MutationErrorInfo) => void>();
  const authCbs = new Set<() => void>();

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

  const setStatus = (s: SyncStatus) => (syncState.value = { ...syncState.value, status: s });
  const meta = async (key: 'clientId' | 'cursor' | 'lastMutationId') =>
    (await db._meta.get(key))?.value;

  function registerMutators(defs: MutatorDef[]) {
    createRegistry([...registry.values(), ...defs]); // дубликат имени → Error
    for (const d of defs) registry.set(d.name, d);
  }

  async function mutate(name: string, args: unknown): Promise<void> {
    const def = registry.get(name);
    if (!def) throw new MutatorError('invalid_args', `неизвестный мутатор: ${name}`);
    const parsed = def.args.safeParse(args);
    if (!parsed.success) throw new MutatorError('invalid_args', parsed.error.message);
    if (!opts) throw new Error('sync не запущен: вызовите startSync');
    const createdAt = new Date().toISOString();
    const undo: Undo[] = [];
    await db.transaction('rw', db.tables, async () => {
      await def.run(new DexieTx(db, undo), parsed.data, ctx(createdAt));
      await db._queue.add({ name, args, createdAt, undo });
    });
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
  }): Promise<MutationErrorInfo[]> {
    const failed: MutationErrorInfo[] = [];
    await db.transaction('rw', db.tables, async () => {
      const queue = await db._queue.orderBy('id').toArray();
      if (p.bootstrap) {
        for (const t of db.entityTables()) {
          await t.clear();
          const rows = p.bootstrap[t.name] ?? [];
          for (let i = 0; i < rows.length; i += 2000) await t.bulkPut(rows.slice(i, i + 2000));
        }
      } else {
        for (const q of queue.slice().reverse()) await applyUndo(db, q.undo ?? []);
        for (const c of p.changes ?? []) {
          if (!db.tables.some((t) => t.name === c.entity)) continue;
          if (c.op === 'put') await db.table(c.entity).put(c.data);
          else await db.table(c.entity).delete(c.id);
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
          await def.run(new DexieTx(db, undo), def.args.parse(q.args), ctx(q.createdAt));
          await db._queue.update(q.id!, { undo });
        } catch (e) {
          // мутация не применима поверх серверного состояния: возвращаем её частичные записи и выбрасываем
          await applyUndo(db, undo);
          await db._queue.delete(q.id!);
          failed.push({
            id: q.id!,
            name: q.name,
            code: e instanceof MutatorError ? e.code : 'internal',
            message: (e as Error).message,
          });
        }
      }
      if (p.cursor !== undefined) await db._meta.put({ key: 'cursor', value: p.cursor });
      if (p.lastMutationId !== undefined)
        await db._meta.put({ key: 'lastMutationId', value: p.lastMutationId });
    });
    if (p.cursor !== undefined) cursor = p.cursor;
    await refreshPending();
    return failed;
  }

  const emitErrors = (list: MutationErrorInfo[]) => {
    for (const e of list) errorCbs.forEach((cb) => cb(e));
  };

  async function http(path: string, init?: RequestInit): Promise<unknown> {
    const f = opts!.fetch ?? globalThis.fetch.bind(globalThis);
    const res = await f((opts!.baseUrl ?? '') + path, init);
    if (!res.ok) throw new HttpError(res.status);
    return res.json();
  }

  async function bootstrap() {
    setStatus('bootstrapping');
    const r = syncBootstrapSchema.parse(await http(`/sync/bootstrap?clientId=${clientId}`));
    emitErrors(
      await applyServer({ bootstrap: r.data, cursor: r.cursor, lastMutationId: r.lastMutationId }),
    );
  }

  async function pull() {
    const r = syncPullSchema.parse(await http(`/sync/pull?cursor=${cursor}&clientId=${clientId}`));
    if (r.reset) return bootstrap();
    emitErrors(
      await applyServer({ changes: r.changes, cursor: r.cursor, lastMutationId: r.lastMutationId }),
    );
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
      const failed = await applyServer({ drop: new Set(rejected.keys()) });
      emitErrors([
        ...[...rejected].map(([id, x]) => ({
          id,
          name: byId.get(id)?.name ?? '',
          code: x.code,
          message: x.message,
        })),
        ...failed,
      ]);
    }
    return true;
  }

  async function cycle() {
    clearTimeout(retryTimer);
    try {
      if (cursor === undefined) await bootstrap();
      else await pull();
      let sent = false;
      while (await push()) sent = true;
      if (sent) await pull();
      failures = 0;
      setStatus('online');
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        setStatus('error');
        authCbs.forEach((cb) => cb());
        return;
      }
      const net = e instanceof TypeError || (e instanceof HttpError && e.status >= 500);
      setStatus(net ? 'offline' : 'error');
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
      wsFailures = 0;
      s.send(JSON.stringify({ t: 'hello', cursor: cursor ?? 0 }));
    };
    s.onmessage = (ev) => {
      let m;
      try {
        m = wsServerSchema.safeParse(JSON.parse(String(ev.data)));
      } catch {
        return;
      }
      if (m.success && m.data.seq > (cursor ?? 0)) void kick();
    };
    s.onclose = (ev) => {
      if (g !== gen) return;
      ws = null;
      if (ev.code === 4401) return authCbs.forEach((cb) => cb());
      wsTimer = setTimeout(() => g === gen && connectWs(), BACKOFF(wsFailures++));
    };
  }

  async function lead(g: number) {
    if (g !== gen) return;
    leading = true;
    await kick();
    if (g !== gen) return;
    connectWs();
  }

  async function startSync(o: StartOpts): Promise<void> {
    await stopSync();
    opts = o;
    const g = ++gen;
    await db.open();
    const id = (await meta('clientId')) as string | undefined;
    clientId = id ?? uuidv7();
    if (!id) await db._meta.put({ key: 'clientId', value: clientId });
    cursor = (await meta('cursor')) as number | undefined;
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

  return {
    registerMutators,
    mutate,
    startSync,
    stopSync,
    syncState: syncState as Readonly<Ref<{ status: SyncStatus; pending: number }>>,
    /** один цикл pull+push сейчас (для тестов) */
    syncNow: () => kick(),
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
