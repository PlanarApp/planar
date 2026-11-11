import type { MutationOrigin, Tx } from '@planar/shared';
import type { Db, Q } from './types.js';

export type { AfterMutationCtx, MutationOrigin, MutationWrite } from '@planar/shared';

export interface JobOpts {
  /** seconds or a moment */
  startAfter?: number | Date;
  singletonKey?: string;
  /** with singletonKey: a queued job with the key gets new data and startAfter instead of a second job (debounce) */
  upsert?: boolean;
}

/** Third argument `afterMutation`. */
export interface ModuleHookApi {
  /** mutation transaction (inside the hook's savepoint) */
  q: Q;
  /** write by the system: bypasses permissions, goes into changes */
  sys: Tx;
  /** pg-boss send in this same transaction */
  enqueue(queue: string, data: object, opts?: JobOpts): Promise<void>;
  /** bot user (users.bot) with this login: idempotent, active, no password; created in the hook's transaction */
  ensureBotUser(login: string, name: string): Promise<string>;
}

export interface JobApi {
  db: Db;
  /**
   * Mutations in one transaction; system — bypass of permissions on behalf of userId.
   * prepare — in the same transaction before the mutations (locks, checks); false → the mutations are not executed.
   * after — in the same transaction after all mutations; enqueue — pg-boss send in it too; an error rolls back everything and exits execute.
   */
  execute(
    userId: string,
    muts: { name: string; args: unknown }[],
    opts?: {
      system?: boolean;
      origin?: MutationOrigin | null;
      prepare?: (q: Q) => Promise<boolean | void>;
      after?: (q: Q, enqueue: ModuleHookApi['enqueue']) => Promise<void>;
    },
  ): Promise<void>;
  /** outside the transaction */
  enqueue(queue: string, data: object, opts?: JobOpts): Promise<void>;
  /** id of the user «Automation» */
  systemUserId: string;
}

export interface JobDef<D = Record<string, unknown>> {
  /** `<moduleId>.<name>` */
  queue: string;
  /** throw → retry via retry* */
  handler(data: D, api: JobApi): Promise<void>;
  /** pg-boss schedule, UTC; data = {} */
  cron?: string;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  expireInSeconds?: number;
  /** default 1 */
  localConcurrency?: number;
}
