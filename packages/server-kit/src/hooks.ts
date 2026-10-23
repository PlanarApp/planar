import type { MutationOrigin, Tx } from '@planar/shared';
import type { Db, Q } from './types.js';

export type { AfterMutationCtx, MutationOrigin, MutationWrite } from '@planar/shared';

export interface JobOpts {
  /** секунды или момент */
  startAfter?: number | Date;
  singletonKey?: string;
}

/** Третий аргумент `afterMutation`. */
export interface ModuleHookApi {
  /** транзакция мутации (внутри точки сохранения хука) */
  q: Q;
  /** запись от системы: обход прав, попадает в changes */
  sys: Tx;
  /** pg-boss send в этой же транзакции */
  enqueue(queue: string, data: object, opts?: JobOpts): Promise<void>;
}

export interface JobApi {
  db: Db;
  /**
   * Мутации одной транзакцией; system — обход прав от имени userId.
   * prepare — в той же транзакции до мутаций (блокировки, проверки); false → мутации не выполняются.
   */
  execute(
    userId: string,
    muts: { name: string; args: unknown }[],
    opts?: {
      system?: boolean;
      origin?: MutationOrigin | null;
      prepare?: (q: Q) => Promise<boolean | void>;
    },
  ): Promise<void>;
  /** вне транзакции */
  enqueue(queue: string, data: object, opts?: JobOpts): Promise<void>;
  /** id пользователя «Автоматизация» */
  systemUserId: string;
}

export interface JobDef<D = Record<string, unknown>> {
  /** `<moduleId>.<имя>` */
  queue: string;
  /** throw → повтор по retry* */
  handler(data: D, api: JobApi): Promise<void>;
  /** pg-boss schedule, UTC; data = {} */
  cron?: string;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
  expireInSeconds?: number;
  /** по умолчанию 1 */
  localConcurrency?: number;
}
