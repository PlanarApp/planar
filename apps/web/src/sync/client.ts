import { liveQuery } from 'dexie';
import { ref, type Ref } from 'vue';
import {
  ENTITIES,
  MutatorError,
  SYNC_PROTOCOL,
  SYNC_PROTOCOL_HEADER,
  SYNC_TASKS_MAX,
  createRegistry,
  syncBootstrapSchema,
  syncPullSchema,
  syncPushResponseSchema,
  syncTasksResponseSchema,
  uuidv7,
  wsServerSchema,
  wsTypingServerSchema,
  type MutatorCtx,
  type MutatorDef,
  type SyncTasksResponse,
} from '@planar/shared';
import {
  dataSig,
  PlanarDB,
  type MetaRow,
  type QueueItem,
  type ReplicaChange,
  type Undo,
} from './db';
import { DexieTx, applyUndo, flushOverlay, overlayKey, type Overlay } from './dexie-tx';

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
  /** C-sync v3: the task of a detail entity row */
  taskId?: string;
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
/** Tables that bootstrap writes in the second stage (rows of the non-open project), with the link field. */
const DEFERRED: Record<string, 'id' | 'taskId'> = {
  tasks: 'id',
  taskAssignees: 'taskId',
  taskLabels: 'taskId',
  checklistItems: 'taskId',
  comments: 'taskId',
  attachments: 'taskId',
  commentReactions: 'taskId', // actually commentId — see splitBootstrap
};
const BATCH = 1000;
/** Detail entities (C-sync v3): their rows are kept only for tasks in `_held`. */
const DETAIL = new Set(
  Object.entries(ENTITIES)
    .filter(([, m]) => (m as { detail?: string }).detail === 'tasks')
    .map(([n]) => n),
);
/** ensureTask: how many times a snapshot older than the local cursor is requested again */
const SNAPSHOT_RETRIES = 3;
/** prefetchTasks: at most one batch of `POST /sync/tasks` per this interval (ms) */
export const PREFETCH_INTERVAL = 500;
/** Cooling (C-sync v3): details of a task not accessed for this long are deleted */
export const COOL_AFTER_MS = 30 * 24 * 3600_000;
/** Cooling runs at most this often (after a successful cycle of the leader) */
const COOL_EVERY_MS = 3600_000;

type Rows = Record<string, unknown>[];

/** Project opened by the address: /p/:projectId or /t/:key (PLN-12 or task uuid). */
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

/** Rows of the open project + the remaining batches; without an open project — undefined (write everything at once). */
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
  // other tabs: the same batches; db.name — so clients of different databases (tests) don't hear each other
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
  /** after commit: to this tab's subscribers and (unless local) to the other tabs */
  const emit = (b: ReplicaChange[], local = false) => {
    if (!b.length) return;
    fire(b);
    if (!local) channel?.postMessage({ db: db.name, batch: b });
  };

  let opts: StartOpts | null = null;
  let gen = 0; // run number: cuts off the tails of previous startSync calls
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
  let cooledAt = 0;

  const setStatus = (s: SyncStatus) => (syncState.value = { ...syncState.value, status: s });
  // PJ-17: the replica was filled under another table/index set (a build update): the cursor says "current",
  // but the new tables are empty (e.g. the old build bootstrapped after the server update) — bootstrap again
  let rebuild = false;
  const meta = async (key: MetaRow['key']) => (await db._meta.get(key))?.value;

  function registerMutators(defs: MutatorDef[]) {
    createRegistry([...registry.values(), ...defs]); // duplicate name → Error
    for (const d of defs) registry.set(d.name, d);
  }

  async function mutate(name: string, input: unknown): Promise<void> {
    return mutateMany([{ name, input }]);
  }

  /**
   * Several mutations in one replica transaction (PLNRAPP-813): one commit and one replica event instead of
   * a transaction per item — a bulk action does not wait N times for IndexedDB and for push/pull rebases
   * between items. All or nothing: an error of any item rolls back the whole batch.
   */
  async function mutateMany(list: { name: string; input: unknown }[]): Promise<void> {
    const items = list.map(({ name, input }) => {
      const def = registry.get(name);
      if (!def) throw new MutatorError('invalid_args', `неизвестный мутатор: ${name}`);
      // arguments are JSON per C-sync; Vue reactive Proxies can't be cloned by IndexedDB (DataCloneError)
      const args: unknown = input === undefined ? undefined : JSON.parse(JSON.stringify(input));
      const parsed = def.args.safeParse(args);
      if (!parsed.success) throw new MutatorError('invalid_args', parsed.error.message);
      return { name, def, args, data: parsed.data };
    });
    if (!opts) throw new Error('sync не запущен: вызовите startSync');
    if (!items.length) return;
    const createdAt = new Date().toISOString();
    const changes: ReplicaChange[] = [];
    await db.transaction('rw', db.tables, async () => {
      changes.length = 0;
      for (const x of items) {
        const undo: Undo[] = [];
        await x.def.run(new DexieTx(db, undo, changes), x.data, ctx(createdAt));
        await db._queue.add({ name: x.name, args: x.args, createdAt, undo });
      }
    });
    emit(changes);
    // pending and sending are picked up by the _queue subscription from startSync (including from other tabs)
  }

  const ctx = (now: string): MutatorCtx => ({ userId: opts!.userId, now, server: false });
  const refreshPending = async () => {
    syncState.value = { ...syncState.value, pending: await db._queue.count() };
  };

  /**
   * `POST /sync/tasks` snapshot into the overlay (inside the applyServer transaction): `ok` — the details of the task
   * are replaced in full, `_held` loaded now; `forbidden`/`not_found` — the details and the `_held` row are deleted.
   */
  async function applySnapshot(s: SyncTasksResponse, ov: Overlay, now: string): Promise<void> {
    for (const t of s.tasks) {
      // the details of the task now: Dexie + overlay (rollback of the queue may have restored rows)
      const comments = new Set(
        (await db.table('comments').where('taskId').equals(t.taskId).primaryKeys()) as string[],
      );
      const reactions = new Set<string>();
      for (const [k, r] of ov)
        if (r && k.startsWith(overlayKey('comments', '')) && r.taskId === t.taskId)
          comments.add(r.id as string);
      if (comments.size)
        for (const id of await db
          .table('commentReactions')
          .where('commentId')
          .anyOf([...comments])
          .primaryKeys())
          reactions.add(id as string);
      for (const [k, r] of ov)
        if (
          r &&
          k.startsWith(overlayKey('commentReactions', '')) &&
          comments.has(r.commentId as string)
        )
          reactions.add(r.id as string);
      for (const id of comments) ov.set(overlayKey('comments', id), null);
      for (const id of reactions) ov.set(overlayKey('commentReactions', id), null);
      if (t.status === 'ok') {
        for (const r of t.comments) ov.set(overlayKey('comments', r.id as string), r);
        for (const r of t.commentReactions)
          ov.set(overlayKey('commentReactions', r.id as string), r);
        await db._held.put({ taskId: t.taskId, loadedAt: now, accessedAt: now });
      } else await db._held.delete(t.taskId);
    }
  }

  /**
   * Server state + queue rebase in one transaction: roll back optimistic writes,
   * apply server ones, drop confirmed/rejected, replay the rest.
   */
  async function applyServer(p: {
    bootstrap?: Record<string, Record<string, unknown>[]>;
    changes?: Change[];
    cursor?: number;
    lastMutationId?: number;
    drop?: Set<number>;
    /** v3 bootstrap: tasks whose details are in `bootstrap` — `_held` rows for them */
    held?: string[];
    /** v3 `POST /sync/tasks`: replaces the details of its tasks; applied only if its cursor ≥ the local one */
    snapshot?: SyncTasksResponse;
  }): Promise<boolean> {
    const g = gen;
    const changes: ReplicaChange[] = [];
    let rest: [string, Rows][] = [];
    let stale = false;
    await db.transaction('rw', db.tables, async () => {
      changes.length = 0;
      rest = [];
      stale = false;
      if (p.snapshot) {
        // the cursor is read in the same transaction: a pull committed meanwhile is taken into account
        const local = (await db._meta.get('cursor'))?.value as number | undefined;
        if (local === undefined || p.snapshot.cursor < local) return void (stale = true);
      }
      const queue = await db._queue.orderBy('id').toArray();
      const now = new Date().toISOString();
      // pull: rollback + server + replay in memory, Dexie gets only the difference (own echo writes nothing)
      const ov: Overlay | undefined = p.bootstrap ? undefined : new Map();
      const out = ov ? undefined : changes;
      if (p.bootstrap) {
        changes.push(RESET);
        // shortcut: with an unconfirmed queue we write everything at once — the rebase must not race with a background write
        const split = queue.length ? undefined : splitBootstrap(p.bootstrap);
        const data = split?.hot ?? p.bootstrap;
        rest = split?.rest ?? [];
        for (const t of db.entityTables()) {
          await t.clear();
          const rows = data[t.name] ?? [];
          for (let i = 0; i < rows.length; i += 2000) await t.bulkPut(rows.slice(i, i + 2000));
        }
        // a reset of the replica clears _held too; v3 — the tasks of the bootstrap details
        await db._held.clear();
        // the C-sync version of this bootstrap: `held` comes only in a v3 answer
        await db._meta.put({ key: 'protocol', value: p.held ? SYNC_PROTOCOL : 2 });
        if (p.held?.length)
          await db._held.bulkPut(
            p.held.map((taskId) => ({ taskId, loadedAt: now, accessedAt: now })),
          );
      } else {
        for (const q of queue.slice().reverse()) await applyUndo(db, q.undo ?? [], undefined, ov);
        // v3: a detail change of a task not in _held is dropped (the cursor advances anyway)
        const tagged = p.changes?.some((c) => c.taskId && DETAIL.has(c.entity));
        const held = tagged ? new Set(await db._held.toCollection().primaryKeys()) : undefined;
        for (const c of p.changes ?? []) {
          if (!db.tables.some((t) => t.name === c.entity)) continue;
          if (held && c.taskId && DETAIL.has(c.entity) && !held.has(c.taskId)) continue;
          ov!.set(overlayKey(c.entity, c.id), c.op === 'put' ? (c.data ?? null) : null);
        }
        if (p.snapshot) await applySnapshot(p.snapshot, ov!, now);
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
          const tx = new DexieTx(db, undo, out, ov);
          await def.run(tx, def.args.parse(q.args), ctx(q.createdAt));
          await db._queue.update(q.id!, { undo });
        } catch {
          // not applicable to the replica: skip the local effect but keep it in the queue — the server decides
          await applyUndo(db, undo, out, ov);
          await db._queue.update(q.id!, { undo: [] });
        }
      }
      if (ov) await flushOverlay(db, ov, changes);
      // the cursor only when the replica is fully in place: an interrupted bootstrap will start over
      if (p.cursor !== undefined && !rest.length) {
        await db._meta.put({ key: 'cursor', value: p.cursor });
        if (p.bootstrap) await db._meta.put({ key: 'schema', value: db.schemaSig() });
      }
      if (p.lastMutationId !== undefined)
        await db._meta.put({ key: 'lastMutationId', value: p.lastMutationId });
    });
    if (stale) return false;
    if (p.bootstrap) replicaState.value = rest.length ? 'partial' : 'complete';
    emit(changes);
    if (rest.length) {
      // other tasks — in batches, yielding the stream to rendering; events only to this tab (in others — a single reset at the end)
      for (const [name, rows] of rest)
        for (let i = 0; i < rows.length; i += BATCH) {
          if (g !== gen) return true; // stopped: cursor not written — bootstrap will repeat
          const part = rows.slice(i, i + BATCH);
          await db.table(name).bulkPut(part);
          emit(
            part.map((row) => ({ entity: name, id: row.id as string, row })),
            true,
          );
          await new Promise((r) => setTimeout(r));
        }
      if (g !== gen) return true;
      await db._meta.put({ key: 'cursor', value: p.cursor! });
      await db._meta.put({ key: 'schema', value: db.schemaSig() });
      replicaState.value = 'complete';
      channel?.postMessage({ db: db.name, batch: [RESET] });
    }
    if (p.cursor !== undefined) cursor = p.cursor;
    await refreshPending();
    return true;
  }

  const emitErrors = (list: MutationErrorInfo[]) => {
    for (const e of list) errorCbs.forEach((cb) => cb(e));
  };

  /** timeout 0 — none: the first load of a big database takes longer than 15 s */
  async function http(path: string, init?: RequestInit, timeout = 15_000): Promise<unknown> {
    const f = opts!.fetch ?? globalThis.fetch.bind(globalThis);
    const signal = timeout
      ? AbortSignal.any([abort.signal, AbortSignal.timeout(timeout)])
      : abort.signal;
    const res = await f((opts!.baseUrl ?? '') + path, { ...init, signal });
    if (!res.ok) {
      // C-http error body {code, message}: show the reason, not "HTTP 403"
      const b = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
      throw new HttpError(res.status, b?.code ?? '', b?.message ?? '');
    }
    return res.json();
  }

  async function bootstrap() {
    setStatus('bootstrapping');
    const r = syncBootstrapSchema.parse(
      // v3 (PLNRAPP-487): without the header the server answers by v2 — all details, no `held`
      await http(
        `/sync/bootstrap?clientId=${clientId}`,
        { headers: { [SYNC_PROTOCOL_HEADER]: String(SYNC_PROTOCOL) } },
        0,
      ),
    );
    await applyServer({
      bootstrap: r.data,
      cursor: r.cursor,
      lastMutationId: r.lastMutationId,
      held: r.held,
    });
  }

  /**
   * C-sync v3: the details of the task are in the replica. Held — only `accessedAt` is updated; otherwise
   * `POST /sync/tasks` and the snapshot via applyServer. A snapshot older than the local cursor (a pull got ahead)
   * is dropped and requested again. false — not loaded (the replica is not bootstrapped yet, the snapshot stays stale).
   */
  async function ensureTask(taskId: string): Promise<boolean> {
    if (!opts) throw new Error('sync не запущен: вызовите startSync');
    const now = new Date().toISOString();
    const touched = await db.transaction('rw', db._held, async () => {
      const h = await db._held.get(taskId);
      if (h) await db._held.put({ ...h, accessedAt: now });
      return !!h;
    });
    if (touched) return true;
    return loadTasks([taskId]);
  }

  /** `POST /sync/tasks` for ≤ SYNC_TASKS_MAX ids; a snapshot older than the local cursor is requested again. */
  async function loadTasks(ids: string[]): Promise<boolean> {
    const g = gen;
    for (let i = 0; i < SNAPSHOT_RETRIES; i++) {
      const snapshot = syncTasksResponseSchema.parse(
        await http('/sync/tasks', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [SYNC_PROTOCOL_HEADER]: String(SYNC_PROTOCOL),
          },
          body: JSON.stringify({ protocol: SYNC_PROTOCOL, ids }),
        }),
      );
      if (g !== gen) return false;
      if (await applyServer({ snapshot })) {
        // forbidden/not_found: not prefetched again in this run
        for (const t of snapshot.tasks) if (t.status !== 'ok') prefetchDenied.add(t.taskId);
        return true;
      }
    }
    return false;
  }

  // prefetch (PLNRAPP-488): hover and idle collect ids, one batch ≤ SYNC_TASKS_MAX per PREFETCH_INTERVAL
  const prefetchQueue = new Set<string>();
  const prefetchDenied = new Set<string>();
  let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
  let prefetchLast = -Infinity;
  let prefetching = false;

  /**
   * Preload the details of tasks not in `_held` (hover, idle): best effort, without touching `accessedAt`
   * of held tasks (prefetch is not an opening). Requests — batches of ≤ SYNC_TASKS_MAX ids, at most one
   * per PREFETCH_INTERVAL; before startSync and before bootstrap — nothing.
   */
  function prefetchTasks(ids: Iterable<string>): void {
    if (!opts) return;
    for (const id of ids) if (!prefetchDenied.has(id)) prefetchQueue.add(id);
    schedulePrefetch();
  }

  function schedulePrefetch() {
    if (prefetchTimer !== undefined || prefetching || !prefetchQueue.size) return;
    const wait = Math.max(0, prefetchLast + PREFETCH_INTERVAL - Date.now());
    prefetchTimer = setTimeout(() => {
      prefetchTimer = undefined;
      void flushPrefetch();
    }, wait);
  }

  async function flushPrefetch(): Promise<void> {
    const g = gen;
    prefetching = true;
    try {
      // before bootstrap a snapshot can't be applied: dropped, the next hover/idle asks again
      if ((await meta('cursor')) === undefined) {
        prefetchQueue.clear();
        return;
      }
      const queued = [...prefetchQueue];
      const held = await db._held.bulkGet(queued);
      const batch: string[] = [];
      queued.forEach((id, i) => {
        if (held[i]) prefetchQueue.delete(id);
        else if (batch.length < SYNC_TASKS_MAX) batch.push(id);
      });
      for (const id of batch) prefetchQueue.delete(id);
      if (!batch.length || g !== gen) return;
      prefetchLast = Date.now();
      // network/server error: the batch is dropped, the next hover/idle requests it again
      await loadTasks(batch).catch(() => false);
    } catch (e) {
      console.error('prefetch', e);
    } finally {
      prefetching = false;
      schedulePrefetch(); // the rest — after PREFETCH_INTERVAL
    }
  }

  /**
   * C-sync v3 cooling: the leader with an empty queue deletes the details, the `_held` row and the y-indexeddb
   * database of tasks not accessed for 30 days, except my open tasks (assigned to me, status not done/cancelled).
   * Returns the ids of the cooled tasks.
   */
  async function cool(now = Date.now()): Promise<string[]> {
    if (!leading) return [];
    const cutoff = new Date(now - COOL_AFTER_MS).toISOString();
    const changes: ReplicaChange[] = [];
    let cooled: string[] = [];
    await db.transaction('rw', db.tables, async () => {
      changes.length = 0;
      cooled = [];
      if (await db._queue.count()) return;
      const stale = (await db._held.where('accessedAt').below(cutoff).primaryKeys()) as string[];
      if (!stale.length) return;
      const mine = new Set<string>();
      const assigned = await db
        .table('taskAssignees')
        .where('taskId')
        .anyOf(stale)
        .filter((r) => r.userId === opts?.userId)
        .toArray();
      const tasks = await db.table('tasks').bulkGet(assigned.map((r) => r.taskId as string));
      const statuses = await db
        .table('statuses')
        .bulkGet(tasks.map((t) => (t?.statusId as string | undefined) ?? ''));
      tasks.forEach((t, i) => {
        const c = statuses[i]?.category;
        if (t && c !== 'done' && c !== 'cancelled') mine.add(t.id as string);
      });
      cooled = stale.filter((id) => !mine.has(id));
      if (!cooled.length) return;
      const comments = (await db
        .table('comments')
        .where('taskId')
        .anyOf(cooled)
        .primaryKeys()) as string[];
      const reactions = comments.length
        ? ((await db
            .table('commentReactions')
            .where('commentId')
            .anyOf(comments)
            .primaryKeys()) as string[])
        : [];
      await db.table('comments').bulkDelete(comments);
      await db.table('commentReactions').bulkDelete(reactions);
      await db._held.bulkDelete(cooled);
      for (const id of comments) changes.push({ entity: 'comments', id, row: null });
      for (const id of reactions) changes.push({ entity: 'commentReactions', id, row: null });
    });
    emit(changes);
    // shortcut: the task's y-indexeddb (description) is kept — it may hold offline edits not yet sent (they go out
    // only when the task is opened); one small database per ever opened task, clean up with a «synced» marker if it grows
    return cooled;
  }

  async function pull() {
    const r = syncPullSchema.parse(await http(`/sync/pull?cursor=${cursor}&clientId=${clientId}`));
    if (r.reset) return bootstrap();
    await applyServer({ changes: r.changes, cursor: r.cursor, lastMutationId: r.lastMutationId });
  }

  /** true — something was sent; limit — mutations per request (halved while the server answers 413) */
  async function push(limit = 100): Promise<boolean> {
    const items = await db._queue.where('id').above(pushedUpTo).limit(limit).toArray();
    if (!items.length) return false;
    const body = {
      clientId,
      mutations: items.map((q) => ({ id: q.id!, name: q.name, args: q.args })),
    };
    let res: unknown;
    try {
      res = await http('/sync/push', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (e) {
      if (!(e instanceof HttpError) || e.status !== 413) throw e;
      if (items.length > 1) return push(items.length >> 1);
      // one mutation over the server's body limit would block the queue forever: refused like a server rejection
      res = {
        results: [
          { id: items[0].id!, ok: false, code: 'invalid_args', message: 'Слишком большая правка' },
        ],
      };
    }
    const r = syncPushResponseSchema.parse(res);
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
      // push first (C-sync: push does not depend on the cursor), then one pull
      const boot = cursor === undefined;
      if (boot || rebuild) await bootstrap();
      rebuild = false;
      if (g !== gen) return;
      let sent = false;
      while (await push()) sent = true;
      if (!boot || sent) await pull();
      failures = 0;
      setStatus('online');
      if (Date.now() - cooledAt >= COOL_EVERY_MS && g === gen) {
        cooledAt = Date.now();
        await cool().catch((e) => console.error('sync cool', e));
      }
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        setStatus('error');
        authCbs.forEach((cb) => cb());
        return;
      }
      // fetch timeout/abort (AbortError, TimeoutError) — treated as a network error
      const net =
        e instanceof TypeError ||
        (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')) ||
        (e instanceof HttpError && e.status >= 500);
      setStatus(net ? 'offline' : 'error');
      // server refusal (not network): changes are not sent — say so, otherwise edits silently pile up in the queue
      if (!net && e instanceof HttpError)
        emitErrors([{ id: 0, name: 'sync', code: e.code || String(e.status), message: e.message }]);
      const g = gen;
      retryTimer = setTimeout(() => g === gen && void kick(), BACKOFF(failures++));
    }
  }

  /** One pull+push cycle at a time; requests arriving during a cycle merge into one retry. */
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
      // stable connection — open ≥ 5 s or a poke received; otherwise the pause grows
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

  /** cursor and replica state from _meta: at start and when a tab becomes the leader (another leader moved them meanwhile) */
  async function readState() {
    cursor = (await meta('cursor')) as number | undefined;
    replicaState.value = cursor === undefined ? 'empty' : 'complete';
    // only a new entity table needs bootstrap: a new index is built by Dexie over the rows in place
    const sig = await meta('schema');
    // PLNRAPP-487/729: a replica bootstrapped by another C-sync version (no protocol or v2, empty _held) — bootstrap again by v3
    rebuild =
      cursor !== undefined &&
      (typeof sig !== 'string' ||
        dataSig(sig) !== db.schemaSig() ||
        (await meta('protocol')) !== SYNC_PROTOCOL);
  }

  async function lead(g: number) {
    if (g !== gen) return;
    await readState();
    if (g !== gen) return;
    leading = true;
    // a warm start doesn't wait for the network; a cold one waits for bootstrap
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
    if (owner !== undefined && owner !== o.userId) await wipe(); // replica of another user
    await db._meta.put({ key: 'userId', value: o.userId });
    const id = (await meta('clientId')) as string | undefined;
    clientId = id ?? uuidv7();
    if (!id) await db._meta.put({ key: 'clientId', value: clientId });
    await readState();
    pushedUpTo = 0;
    failures = wsFailures = 0;
    setStatus('idle');
    await refreshPending();
    // all tabs watch the queue; the leader sends new items from any tab
    const sub = liveQuery(async () => ({
      n: await db._queue.count(),
      last: (await db._queue.orderBy('id').last())?.id ?? 0,
      // a follower tab learns that the leader has filled the replica
      filled: (await meta('cursor')) !== undefined,
    })).subscribe({
      next: ({ n, last, filled }) => {
        syncState.value = { ...syncState.value, pending: n };
        if (leading && last > pushedUpTo) void kick();
        if (!leading && filled && replicaState.value === 'empty') replicaState.value = 'complete';
      },
      // the subscription is over: new edits are sent only on WS pokes and retries
      error: (e) => console.error('sync queue', e),
    });
    unsub = () => sub.unsubscribe();
    if (typeof window !== 'undefined') {
      onlineHandler = () => void kick();
      window.addEventListener('online', onlineHandler);
    }
    const locks = globalThis.navigator?.locks;
    if (!locks) return lead(g);
    // tabs: the leader (navigator.locks) runs WS/pull/push, the others only write to _queue
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
    clearTimeout(prefetchTimer);
    prefetchTimer = undefined;
    prefetchQueue.clear();
    prefetchDenied.clear();
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
    await leaderLock; // the lock is released before return: a new startSync will become the leader
    leaderLock = null;
    await running;
  }

  /** clear the replica, queue and _meta; a new clientId */
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
    mutateMany,
    ensureTask,
    prefetchTasks,
    startSync,
    stopSync,
    syncState: syncState as Readonly<Ref<{ status: SyncStatus; pending: number }>>,
    /** one pull+push cycle now (for tests) */
    syncNow: () => kick(),
    /** cooling of task details now (for tests); `now` — the current time in ms */
    coolNow: (now?: number) => cool(now),
    replicaState: replicaState as Readonly<Ref<ReplicaState>>,
    onReplicaChange(cb: (batch: ReplicaChange[]) => void) {
      replicaCbs.add(cb);
      return () => void replicaCbs.delete(cb);
    },
    /** "Typing…" (C-sync v2): if WS is not open — nothing. */
    sendTyping(entity: string, id: string): void {
      try {
        ws?.send(JSON.stringify({ t: 'typing', entity, id }));
      } catch {
        // connection is still opening/closed — no ephemeral message needed
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
