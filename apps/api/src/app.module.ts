import {
  Inject,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type Type,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CORE, CoreService } from './core.service.js';
import { AUTH_OPTS, type AuthOpts } from './auth/auth.js';
import { AuthController } from './auth/auth.controller.js';
import { SetupController } from './auth/setup.controller.js';
import { TokensController } from './tokens/tokens.controller.js';
import { UsersController } from './users/users.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import type { Db } from './db/index.js';
import { FILES_OPTS, FilesController, type FilesOpts } from './files/files.controller.js';
import { HealthController } from './health.controller.js';
import { JobsService, PUSH_OPTS } from './jobs/jobs.js';
import type { PushOpts } from './push/push.js';
import { ensureSystemUser } from './users/system.js';
import { ModuleGuard, ModulesController } from './modules/module.guard.js';
import { installed } from './modules/installed.js';
import { McpController } from './mcp/mcp.controller.js';
import { restControllers, restProviders } from './rest/index.js';
import { syncControllers, syncProviders } from './sync/sync.module.js';
import { DB } from './tokens.js';

@Module({})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onModuleInit() {
    // БД недоступна — приложение всё равно стартует (health вернёт 503), пользователь появится при следующем старте
    await ensureSystemUser(this.db).catch((e) => new Logger('app').error(e));
  }

  /** app.close() закрывает пул (и в тестах, и по SIGTERM) */
  async onApplicationShutdown() {
    await this.db.$client.end();
  }

  static register(
    db: Db,
    auth: AuthOpts,
    files: FilesOpts,
    push: PushOpts,
    extraControllers: Type[] = [],
  ): DynamicModule {
    return {
      module: AppModule,
      global: true, // DB и JobsService доступны модулям без импорта
      exports: [DB, JobsService, CORE],
      imports: installed.map((m) => m.api.nestModule as Type),
      controllers: [
        HealthController,
        AuthController,
        SetupController,
        UsersController,
        TokensController,
        FilesController,
        ModulesController,
        ...syncControllers,
        ...restControllers,
        McpController,
        ...extraControllers,
      ],
      providers: [
        { provide: DB, useValue: db },
        { provide: AUTH_OPTS, useValue: auth },
        { provide: FILES_OPTS, useValue: files },
        { provide: PUSH_OPTS, useValue: push },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: ModuleGuard },
        JobsService,
        CoreService,
        { provide: CORE, useExisting: CoreService },
        ...syncProviders,
        ...restProviders,
      ],
    };
  }
}
