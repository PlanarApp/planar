// Fake C-sync server: changes log, last_mutation_id per clientId, the same MutatorDefs; responses are checked against shared schemas.
import {
  MutatorError,
  entitySchemas,
  syncBootstrapSchema,
  syncPullSchema,
  syncPushRequestSchema,
  syncPushResponseSchema,
  syncTasksRequestSchema,
  syncTasksResponseSchema,
  type EntityName,
  type MutatorDef,
  type Tx,
} from '@planar/shared';

type Rows = Map<string, Map<string, Record<string, unknown>>>;
interface Change {
  seq: number;
  entity: string;
  id: string;
  op: 'put' | 'del';
  data?: Record<string, unknown>;
  taskId?: string;
}

export class FakeServer {
  rows: Rows = new Map();
  log: Change[] = [];
  seq = 0;
  lastMut = new Map<string, number>();
  mode: 'ok' | 'offline' | '5xx' | '401' | '403' = 'ok';
  /** the next push mutation will be rejected with this code */
  rejectNext: string | null = null;
  resetNext = false;
  /** push fails with a network error, pull/bootstrap work */
  blockPush = false;
  /** once, before answering a pull (cycle: push → pull) — a local edit "between push and pull" */
  beforePull: (() => Promise<void>) | null = null;
  /** C-sync v3: pull changes of comments/commentReactions carry taskId, bootstrap — `held` */
  v3 = false;
  /** v3 bootstrap: `held` */
  held: string[] = [];
  /** POST /sync/tasks: tasks that exist but are not visible */
  forbidden = new Set<string>();
  /** once, before answering POST /sync/tasks — e.g. a pull that gets ahead of the snapshot */
  beforeTasks: (() => Promise<void>) | null = null;
  /** POST /sync/tasks answers with this cursor (a snapshot older than the client's), null — the current one */
  tasksCursor: number | null = null;
  tasksRequests = 0;
  pushes = 0;
  pulls = 0;
  bootstraps = 0;
  constructor(
    public mutators: MutatorDef[],
    public entities: string[] = Object.keys(entitySchemas),
  ) {}

  seed(entity: string, list: Record<string, unknown>[]) {
    const m = this.rows.get(entity) ?? new Map();
    this.rows.set(entity, m);
    for (const r of list) {
      m.set(r.id as string, r);
      const taskId = this.taskOf(entity, r);
      this.log.push({ seq: ++this.seq, entity, id: r.id as string, op: 'put', data: r, taskId });
    }
  }

  /** the task of a detail row (C-sync v3) */
  taskOf(entity: string, row: Record<string, unknown> | undefined): string | undefined {
    if (!row) return undefined;
    if (entity === 'comments') return row.taskId as string;
    if (entity === 'commentReactions')
      return this.rows.get('comments')?.get(row.commentId as string)?.taskId as string | undefined;
    return undefined;
  }

  remove(entity: string, id: string) {
    const taskId = this.taskOf(entity, this.rows.get(entity)?.get(id));
    this.rows.get(entity)?.delete(id);
    this.log.push({ seq: ++this.seq, entity, id, op: 'del', taskId });
  }

  /** a journal row as pull sends it: taskId — only v3 */
  private wire({ taskId, ...c }: Change): Change {
    return this.v3 && taskId ? { ...c, taskId } : c;
  }

  private tx(rows: Rows, out: Change[]): Tx {
    const t = (e: string) => rows.get(e) ?? rows.set(e, new Map()).get(e)!;
    const chk = (e: string, r: unknown) => {
      const p = entitySchemas[e as EntityName].safeParse(r);
      if (!p.success) throw new MutatorError('invalid_args', p.error.message);
      return p.data as Record<string, unknown>;
    };
    const put = (e: string, r: Record<string, unknown>) => {
      t(e).set(r.id as string, r);
      out.push({ seq: 0, entity: e, id: r.id as string, op: 'put', data: r });
    };
    return {
      get: async (e, id) => structuredClone(t(e).get(id)) as never,
      put: async (e, r) => put(e, chk(e, r)),
      patch: async (e, id, p) => {
        const cur = t(e).get(id);
        if (!cur) throw new MutatorError('not_found', id);
        put(e, chk(e, { ...cur, ...p }));
      },
      del: async (e, id) => {
        if (t(e).delete(id)) out.push({ seq: 0, entity: e, id, op: 'del' });
      },
      scan: async (e, o) =>
        [...t(e).values()]
          .filter((r) => !o || r[o.index] === o.eq)
          .map((r) => structuredClone(r)) as never,
    };
  }

  /** Executes the mutation as the server does (idempotent by id). Returns the push result. */
  async runMutation(clientId: string, id: number, name: string, args: unknown) {
    if (id <= (this.lastMut.get(clientId) ?? 0)) return { id, ok: true as const };
    const fail = (code: string, message: string) => {
      this.lastMut.set(clientId, id);
      return { id, ok: false as const, code: code as 'internal', message };
    };
    if (this.rejectNext) {
      const code = this.rejectNext;
      this.rejectNext = null;
      return fail(code, 'rejected by test');
    }
    const def = this.mutators.find((m) => m.name === name);
    if (!def) return fail('unknown_mutator', name);
    const parsed = def.args.safeParse(args);
    if (!parsed.success) return fail('invalid_args', parsed.error.message);
    const copy: Rows = new Map([...this.rows].map(([k, v]) => [k, new Map(v)]));
    const out: Change[] = [];
    try {
      await def.run(this.tx(copy, out), parsed.data, {
        userId: 'server',
        now: new Date().toISOString(),
        server: true,
      });
    } catch (e) {
      return fail(e instanceof MutatorError ? e.code : 'internal', (e as Error).message);
    }
    this.rows = copy;
    for (const c of out) this.log.push({ ...c, seq: ++this.seq });
    this.lastMut.set(clientId, id);
    return { id, ok: true as const };
  }

  private json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (this.mode === 'offline') throw new TypeError('Failed to fetch');
    if (this.mode === '5xx') return this.json({ error: 'internal' }, 500);
    if (this.mode === '401') return this.json({ error: 'unauthenticated' }, 401);
    if (this.mode === '403')
      return this.json(
        { code: 'origin_mismatch', message: 'Origin не совпадает с PUBLIC_URL' },
        403,
      );
    const url = new URL(String(input), 'http://test');
    const clientId = url.searchParams.get('clientId') ?? '';
    if (url.pathname === '/sync/bootstrap') {
      this.bootstraps++;
      const data: Record<string, Record<string, unknown>[]> = {};
      for (const e of this.entities) data[e] = [...(this.rows.get(e)?.values() ?? [])];
      return this.json(
        syncBootstrapSchema.parse({
          cursor: this.seq,
          lastMutationId: this.lastMut.get(clientId) ?? 0,
          data,
          ...(this.v3 ? { held: this.held } : {}),
        }),
      );
    }
    if (url.pathname === '/sync/pull') {
      this.pulls++;
      const hook = this.beforePull;
      this.beforePull = null;
      await hook?.();
      const cursor = Number(url.searchParams.get('cursor'));
      const reset = this.resetNext || cursor > this.seq;
      this.resetNext = false;
      return this.json(
        syncPullSchema.parse({
          cursor: this.seq,
          lastMutationId: this.lastMut.get(clientId) ?? 0,
          changes: reset ? [] : this.log.filter((c) => c.seq > cursor).map((c) => this.wire(c)),
          ...(reset ? { reset: true } : {}),
        }),
      );
    }
    if (url.pathname === '/sync/tasks') {
      this.tasksRequests++;
      const hook = this.beforeTasks;
      this.beforeTasks = null;
      const req = syncTasksRequestSchema.parse(JSON.parse(String(init?.body)));
      const cursor = this.tasksCursor ?? this.seq;
      const tasks = req.ids.map((taskId) => {
        if (this.forbidden.has(taskId)) return { taskId, status: 'forbidden' as const };
        if (!this.rows.get('tasks')?.has(taskId)) return { taskId, status: 'not_found' as const };
        const comments = [...(this.rows.get('comments')?.values() ?? [])].filter(
          (c) => c.taskId === taskId,
        );
        const ids = new Set(comments.map((c) => c.id));
        const commentReactions = [...(this.rows.get('commentReactions')?.values() ?? [])].filter(
          (r) => ids.has(r.commentId),
        );
        return { taskId, status: 'ok' as const, comments, commentReactions };
      });
      await hook?.();
      return this.json(syncTasksResponseSchema.parse({ cursor, tasks }));
    }
    if (url.pathname === '/sync/push') {
      if (this.blockPush) throw new TypeError('Failed to fetch');
      this.pushes++;
      const req = syncPushRequestSchema.parse(JSON.parse(String(init?.body)));
      const results = [];
      for (const m of req.mutations)
        results.push(await this.runMutation(req.clientId, m.id, m.name, m.args));
      return this.json(syncPushResponseSchema.parse({ results }));
    }
    return this.json({ error: 'not_found' }, 404);
  };
}

export class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static times: number[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  sent: string[] = [];
  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
    FakeWebSocket.times.push(Date.now());
  }
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.onclose?.({ code: 1000 });
  }
  // --- control from the test
  open() {
    this.onopen?.();
  }
  poke(seq: number) {
    this.onmessage?.({ data: JSON.stringify({ t: 'poke', seq }) });
  }
  drop(code = 1006) {
    this.onclose?.({ code });
  }
  static reset() {
    FakeWebSocket.instances = [];
    FakeWebSocket.times = [];
  }
}
