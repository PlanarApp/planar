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
}

/** Nest-провайдер (глобальный) со значением CoreServices; модуль: `@Inject(CORE) core: CoreServices`. */
export const CORE = Symbol.for('planar.core');
