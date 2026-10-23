import { Logger } from '@nestjs/common';
import {
  MutatorError,
  type AfterMutationCtx,
  type MutationOrigin,
  type MutationWrite,
  type SyncPushResponse,
} from '@planar/shared';
import type { Db } from '../db/index.js';
import type { JobsService } from '../jobs/jobs.js';
import { enabledModules } from '../modules/enabled.js';
import type { ModuleHookApi } from '../modules/hooks.js';
import { installed } from '../modules/installed.js';
import { notificationsHook } from '../notifications/hook.js';
import type { PushQueue } from '../push/push.js';
import { findMutator } from './registry.js';
import { ServerTx, type Q } from './server-tx.js';

export type FailCode = Extract<SyncPushResponse['results'][number], { ok: false }>['code'];

/** Мутация отклонена: откат транзакции. */
export class Reject extends Error {
  constructor(
    public code: FailCode,
    message: string,
  ) {
    super(message);
  }
}

const log = new Logger('mutate');

// сбой соединения/сервера БД — 500 целиком, а не отказ мутации
function isInfra(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  const code = e.cause?.code ?? e.code ?? '';
  return /^(08|53|57)/.test(code) || /^E(CONN|PIPE|TIMEDOUT|HOST|NOTFOUND)/.test(code);
}

export interface RunOpts {
  /** обход прав (ServerTx.asSystem) */
  system?: boolean;
  origin?: MutationOrigin | null;
  /** для enqueue из хуков модулей; без него enqueue — no-op */
  jobs?: JobsService;
}

/** afterMutation включённых модулей: каждый в точке сохранения, ошибка не откатывает мутацию. */
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
  for (const m of hooked.filter((m) => on.has(m.api.id))) {
    try {
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
        };
        await m.api.afterMutation!(writes, ctx, api as never);
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

/** Одна мутация внутри открытой транзакции: ServerTx + хук уведомлений + хуки модулей. Ошибка → Reject. */
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

/** Мутации одной транзакцией (REST); при Reject откат целиком. Push — после COMMIT. */
export async function executeMutations(
  db: Db,
  userId: string,
  muts: { name: string; args: unknown }[],
  queue?: PushQueue,
  tokenId?: string,
  opts?: Pick<RunOpts, 'system' | 'origin'>,
): Promise<void> {
  const notified: string[] = [];
  await db.transaction(async (tx) => {
    for (const m of muts)
      await runMutation(tx, userId, m, notified, tokenId, { ...opts, jobs: queue?.jobs });
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
