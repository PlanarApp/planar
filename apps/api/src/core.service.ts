import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { CORE, HttpError, type AuthCtx, type CoreServices, type JobOpts } from '@planar/server-kit';
import { JobsService } from './jobs/jobs.js';
import { getAuth } from './auth/auth.js';
import type { Db } from './db/index.js';
import { toV1Tasks } from './rest/v1-tasks.js';
import { DB } from './tokens.js';
import { ensureSystemUser } from './users/system.js';

export { CORE };

/** Услуги ядра модулям (C-modules v4): провайдер `CORE`. */
@Injectable()
export class CoreService implements CoreServices, OnModuleInit, OnModuleDestroy {
  private sysId?: string;
  constructor(
    @Inject(DB) readonly db: Db,
    @Inject(JobsService) private jobs: JobsService,
  ) {}

  retryMs = 2000;
  private timer?: NodeJS.Timeout;

  /** БД недоступна — старт не падает; повторяем с интервалом, пока systemUserId не станет доступен */
  async onModuleInit() {
    try {
      this.sysId = await ensureSystemUser(this.db);
    } catch {
      this.timer = setTimeout(() => void this.onModuleInit(), this.retryMs).unref();
    }
  }

  onModuleDestroy() {
    clearTimeout(this.timer);
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

  enqueue(queue: string, data: object, opts?: JobOpts) {
    return this.jobs.enqueue(queue, data, opts);
  }

  systemUserId(): string {
    if (!this.sysId) throw new Error('системный пользователь ещё не создан');
    return this.sysId;
  }
}
