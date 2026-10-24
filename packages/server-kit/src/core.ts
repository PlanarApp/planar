import type { JobApi, JobOpts } from './hooks.js';
import type { Db, Q } from './types.js';

export interface AuthCtx {
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  tokenId: string | null;
  tokenScope: 'read' | 'write' | null;
}

export interface CoreServices {
  db: Db;
  /** как getAuth api; нет входа → 401 */
  auth(req: object): AuthCtx;
  /** не owner/admin → 403; sessionOnly и Bearer → 403 */
  requireInstanceAdmin(req: object, opts?: { sessionOnly?: boolean }): AuthCtx;
  /** строки tasks → форма REST v1 (key, assigneeIds, labelIds) */
  toV1Tasks(q: Q | Db, rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]>;
  systemUserId(): string;
  /** задача pg-boss вне транзакции мутации; push.boss:false — no-op (C-modules v5) */
  enqueue(queue: string, data: object, opts?: JobOpts): Promise<void>;
  /** мутации одной транзакцией от имени userId — как JobApi.execute (C-modules v9) */
  execute: JobApi['execute'];
  /** системный пользователь с логином login: идемпотентно, деактивирован, без пароля (C-modules v9) */
  ensureSystemUser(login: string, name: string): Promise<string>;
  /** файл в хранилище, как POST /files: нет файла → создать; больше MAX_UPLOAD_MB → 413 (C-modules v9) */
  storeFile(
    buf: Buffer,
    uploaderId: string,
    mime?: string,
  ): Promise<{
    sha256: string;
    size: number;
    mime: string;
    width: number | null;
    height: number | null;
  }>;
}

/** Nest-провайдер (глобальный) со значением CoreServices; модуль: `@Inject(CORE) core: CoreServices`. */
export const CORE = Symbol.for('planar.core');
