import {
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type Type,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AUTH_OPTS, type AuthOpts } from './auth/auth.js';
import { AuthController } from './auth/auth.controller.js';
import { SetupController } from './auth/setup.controller.js';
import { TokensController } from './tokens/tokens.controller.js';
import { UsersController } from './users/users.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import type { Db } from './db/index.js';
import { FILES_OPTS, FilesController, type FilesOpts } from './files/files.controller.js';
import { HealthController } from './health.controller.js';
import { PUSH_OPTS, type PushOpts } from './push/push.js';
import { ModuleGuard, ModulesController } from './modules/module.guard.js';
import { installed } from './modules/installed.js';
import { restControllers, restProviders } from './rest/index.js';
import { syncControllers, syncProviders } from './sync/sync.module.js';
import { DB } from './tokens.js';

@Module({})
export class AppModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

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
        ...extraControllers,
      ],
      providers: [
        { provide: DB, useValue: db },
        { provide: AUTH_OPTS, useValue: auth },
        { provide: FILES_OPTS, useValue: files },
        { provide: PUSH_OPTS, useValue: push },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: ModuleGuard },
        ...syncProviders,
        ...restProviders,
      ],
    };
  }
}
