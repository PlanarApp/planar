import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { CORE, HttpError, type AuthCtx, type CoreServices } from '@planar/server-kit';
import { getAuth } from './auth/auth.js';
import type { Db } from './db/index.js';
import { toV1Tasks } from './rest/v1-tasks.js';
import { DB } from './tokens.js';
import { ensureSystemUser } from './users/system.js';

export { CORE };

/** Услуги ядра модулям (C-modules v4): провайдер `CORE`. */
@Injectable()
export class CoreService implements CoreServices, OnModuleInit {
  private sysId?: string;
  constructor(@Inject(DB) readonly db: Db) {}

  /** БД недоступна — старт не падает; systemUserId подтянется при первом обращении к БД */
  async onModuleInit() {
    this.sysId = await ensureSystemUser(this.db).catch(() => undefined);
  }

  auth(req: object): AuthCtx {
    const a = getAuth(req);
    return {
      userId: a.userId,
      role: a.role,
      tokenId: a.tokenId ?? null,
      tokenScope: a.tokenScope ?? null,
    };
  }

  requireInstanceAdmin(req: object, opts?: { sessionOnly?: boolean }): AuthCtx {
    const a = getAuth(req);
    if (opts?.sessionOnly && a.via === 'token')
      throw new HttpError(403, 'forbidden', 'Только из сессии');
    if (a.role !== 'owner' && a.role !== 'admin')
      throw new HttpError(403, 'forbidden', 'Нужна роль владельца или администратора');
    return this.auth(req);
  }

  toV1Tasks(q: Parameters<CoreServices['toV1Tasks']>[0], rows: Record<string, unknown>[]) {
    return toV1Tasks(q as Db, rows) as Promise<Record<string, unknown>[]>;
  }

  systemUserId(): string {
    if (!this.sysId) throw new Error('системный пользователь ещё не создан');
    return this.sysId;
  }
}
