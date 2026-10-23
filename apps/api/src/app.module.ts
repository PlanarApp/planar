import { Module, type DynamicModule, type Type } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AUTH_OPTS, type AuthOpts } from './auth/auth.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import type { Db } from './db/index.js';
import { FILES_OPTS, FilesController, type FilesOpts } from './files/files.controller.js';
import { HealthController } from './health.controller.js';
import { syncControllers, syncProviders } from './sync/sync.module.js';
import { DB } from './tokens.js';

@Module({})
export class AppModule {
  static register(
    db: Db,
    auth: AuthOpts,
    files: FilesOpts,
    extraControllers: Type[] = [],
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        AuthController,
        FilesController,
        ...syncControllers,
        ...extraControllers,
      ],
      providers: [
        { provide: DB, useValue: db },
        { provide: AUTH_OPTS, useValue: auth },
        { provide: FILES_OPTS, useValue: files },
        { provide: APP_GUARD, useClass: AuthGuard },
        ...syncProviders,
      ],
    };
  }
}
