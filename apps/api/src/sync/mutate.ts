import { Logger } from '@nestjs/common';
import {
  MutatorError,
  isDataModule,
  type AfterMutationCtx,
  type MutatorDef,
  type MutationOrigin,
  type MutationWrite,
  type SyncPushResponse,
} from '@planar/shared';
import type { Db } from '../db/index.js';
import type { JobsService } from '../jobs/jobs.js';
import { enabledModules, projectModules, projectOfRow } from '../modules/enabled.js';
import type { ModuleHookApi } from '../modules/hooks.js';
import { installed } from '../modules/installed.js';
import { notificationsHook } from '../notifications/hook.js';
import type { PushQueue } from '../push/push.js';
import { ensureSystemUser } from '../users/system.js';
import { findMutator } from './registry.js';
import { ServerTx, type Q } from './server-tx.js';

export type FailCode = Extract<SyncPushResponse['results'][number], { ok: false }>['code'];

/** Mutation rejected: transaction rollback. */
export class Reject extends Error {
  constructor(
    public code: FailCode,
    message: string,
  ) {
    super(message);
  }
}

const log = new Logger('mutate');

// DB connection/server failure — 500 as a whole, not a mutation rejection
function isInfra(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  const code = e.cause?.code ?? e.code ?? '';
  return /^(08|53|57)/.test(code) || /^E(CONN|PIPE|TIMEDOUT|HOST|NOTFOUND)/.test(code);
}

export interface RunOpts {
  /** bypass of rights (ServerTx.asSystem) */
  system?: boolean;
  origin?: MutationOrigin | null;
  /** for enqueue from module hooks; without it enqueue is a no-op */
  jobs?: JobsService;
}

/** Writes of projects where the data module is on, and writes not tied to a project (or to a project that no longer exists). */
async function filterWrites(
  tx: Q,
  moduleId: string,
  writes: MutationWrite[],
  cache: Map<string, string | null>,
  modulesOf: Map<string, Set<string> | null>,
): Promise<MutationWrite[]> {
  const out: MutationWrite[] = [];
  for (const w of writes) {
    const pid = await projectOfRow(tx, w.entity, (w.after ?? w.before)!, cache);
    if (pid && !modulesOf.has(pid)) modulesOf.set(pid, await projectModules(tx, pid));
    const mods = pid ? modulesOf.get(pid) : null;
    if (!mods || mods.has(moduleId)) out.push(w);
  }
  return out;
}

/** Data-module mutator: every project it touches must have the module on, else conflict module_disabled (C-schema v16). */
async function gateProjectModules(
  tx: Q,
  stx: ServerTx,
  def: MutatorDef,
  args: unknown,
): Promise<void> {
  const owner = installed.find((m) => m.api.mutators.includes(def));
  if (!owner || !isDataModule(owner.api.id)) return;
  const cache = new Map<string, string | null>();
  const created = new Set(
    stx.writes.filter((w) => w.entity === 'projects' && !w.before).map((w) => w.after!.id),
  );
  const ids = new Set<string>();
  const a = (args ?? {}) as Record<string, unknown>;
  if (typeof a.projectId === 'string') ids.add(a.projectId);
  if (typeof a.taskId === 'string') {
    const p = await projectOfRow(tx, 'tasks_ref', { taskId: a.taskId }, cache);
    if (p) ids.add(p);
  }
  for (const w of stx.writes) {
    if (!owner.api.entities[w.entity]) continue;
    const p = await projectOfRow(tx, w.entity, (w.after ?? w.before)!, cache);
    if (p) ids.add(p);
  }
  for (const id of ids) {
    if (created.has(id)) continue;
    const mods = await projectModules(tx, id);
    if (mods && !mods.has(owner.api.id))
      throw new MutatorError('conflict', `module_disabled: ${owner.api.id}`);
  }
}

/** afterMutation of enabled modules: each in its own savepoint; an error does not roll back the mutation. */
async function moduleHooks(
  tx: Q,
  stx: ServerTx,
  ctx: AfterMutationCtx,
  opts: RunOpts,
): Promise<void> {
  const hooked = installed.filter((m) => m.api.afterMutation);
  if (!hooked.length) return;
  const on = await enabledModules(tx);
  const writes: MutationWrite[] = stx.writes.map((w) => ({
    entity: w.entity,
    op: w.op,
    before: w.before ?? null,
    after: w.after ?? null,
  }));
  const cache = new Map<string, string | null>();
  const modulesOf = new Map<string, Set<string> | null>();
  for (const m of hooked.filter((m) => on.has(m.api.id))) {
    try {
      // C-schema v16: a data module does not see writes of projects where it is off
      const mine = isDataModule(m.api.id)
        ? await filterWrites(tx, m.api.id, writes, cache, modulesOf)
        : writes;
      if (!mine.length) continue;
      await tx.transaction(async (sp) => {
        const sys = ServerTx.asSystem(sp, {
          userId: ctx.userId,
          tokenId: ctx.tokenId ?? undefined,
          now: ctx.now,
        });
        const api: ModuleHookApi = {
          q: sp,
          sys,
          enqueue: async (queue, data, o) => void (await opts.jobs?.enqueue(queue, data, o, sp)),
          ensureBotUser: (login, name) => ensureSystemUser(sp, login, name, true),
        };
        await m.api.afterMutation!(mine, ctx, api as never);
        await sys.finish();
      });
    } catch (err) {
      if (isInfra(err)) throw err;
      log.error(
        `afterMutation ${m.api.id}: ${err instanceof Error ? (err.stack ?? err.message) : err}`,
      );
    }
  }
}

/** One mutation inside an open transaction: ServerTx + notification hook + module hooks. An error → Reject. */
export async function runMutation(
  tx: Q,
  userId: string,
  m: { name: string; args: unknown },
  notified: string[],
  tokenId?: string,
  opts: RunOpts = {},
): Promise<void> {
  const def = await findMutator(tx, m.name);
  if (!def) throw new Reject('unknown_mutator', `нет мутатора ${m.name}`);
  const args = def.args.safeParse(m.args);
  if (!args.success) throw new Reject('invalid_args', args.error.message);
  const sctx = { userId, tokenId };
  const stx = opts.system ? ServerTx.asSystem(tx, sctx) : new ServerTx(tx, sctx);
  const now = new Date().toISOString();
  try {
    await def.run(stx, args.data, { userId, now, server: true });
    await gateProjectModules(tx, stx, def, args.data);
    const hook = await notificationsHook(tx, stx, { userId, now });
    notified.push(...hook.ids);
    await moduleHooks(
      tx,
      stx,
      {
        userId,
        now,
        tokenId: tokenId ?? null,
        mutator: m.name,
        system: !!opts.system,
        origin: opts.origin ?? null,
      },
      opts,
    );
    await stx.finish();
    await hook.tx.finish();
  } catch (err) {
    if (isInfra(err)) throw err;
    if (err instanceof MutatorError) throw new Reject(err.code, err.message);
    log.error(err);
    throw new Reject('internal', 'Внутренняя ошибка');
  }
}

/** Mutations in one transaction (REST); on Reject the whole thing rolls back. Push — after COMMIT. */
export async function executeMutations(
  db: Db,
  userId: string,
  muts: { name: string; args: unknown }[],
  queue?: PushQueue,
  tokenId?: string,
  opts?: Pick<RunOpts, 'system' | 'origin'> & {
    prepare?: (q: Q) => Promise<boolean | void>;
    after?: (q: Q, enqueue: ModuleHookApi['enqueue']) => Promise<void>;
  },
): Promise<void> {
  const notified: string[] = [];
  await db.transaction(async (tx) => {
    // locks and checks in the same transaction; false — mutations are skipped
    if ((await opts?.prepare?.(tx)) === false) return;
    for (const m of muts)
      await runMutation(tx, userId, m, notified, tokenId, { ...opts, jobs: queue?.jobs });
    await opts?.after?.(
      tx,
      async (name, data, o) => void (await queue?.jobs.enqueue(name, data, o, tx)),
    );
  });
  await queue?.enqueue(notified);
}

export const executeMutation = (
  db: Db,
  userId: string,
  name: string,
  args: unknown,
  queue?: PushQueue,
) => executeMutations(db, userId, [{ name, args }], queue);
