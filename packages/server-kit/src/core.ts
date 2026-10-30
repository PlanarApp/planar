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
  /** same as api getAuth; no login → 401 */
  auth(req: object): AuthCtx;
  /** not owner/admin → 403; sessionOnly and Bearer → 403 */
  requireInstanceAdmin(req: object, opts?: { sessionOnly?: boolean }): AuthCtx;
  /** tasks rows → REST v1 form (key, assigneeIds, labelIds) */
  toV1Tasks(q: Q | Db, rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]>;
  systemUserId(): string;
  /** pg-boss task outside the mutation transaction; push.boss:false — no-op (C-modules v5) */
  enqueue(queue: string, data: object, opts?: JobOpts): Promise<void>;
  /** mutations in one transaction on behalf of userId — like JobApi.execute (C-modules v9) */
  execute: JobApi['execute'];
  /** system user with login login: idempotent, deactivated, without password (C-modules v9) */
  ensureSystemUser(login: string, name: string): Promise<string>;
  /** file in storage, like POST /files: no file → create; more than MAX_UPLOAD_MB → 413 (C-modules v9) */
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

/** Nest provider (global) with the CoreServices value; module: `@Inject(CORE) core: CoreServices`. */
export const CORE = Symbol.for('planar.core');
