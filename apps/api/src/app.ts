import 'reflect-metadata';
import type { Type } from '@nestjs/common';
import multipart from '@fastify/multipart';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { createDb } from './db/index.js';
import type { CollabOpts } from './collab/options.js';
import type { PushOpts } from './push/push.js';
import { ErrorFilter } from './error.filter.js';

export interface AppOptions {
  databaseUrl: string;
  /** origin для проверки Origin и cookie */
  publicUrl: string;
  cookieSecure?: boolean;
  /** корень хранилища файлов (DATA_DIR) */
  dataDir?: string;
  /** лимит загрузки, МБ (MAX_UPLOAD_MB) */
  maxUploadMb?: number;
  /** pg-boss и Web Push; в тестах без настроек очередь выключена */
  push?: Partial<Omit<PushOpts, 'databaseUrl'>>;
  /** только тесты: дополнительные контроллеры */
  extraControllers?: Type[];
  /** только тесты: debounce сохранения совместного редактирования */
  collab?: Partial<CollabOpts>;
  /** опции pino Fastify; false — без логов (тесты) */
  logger?: boolean | { level: string };
}

/** Общая фабрика для main.ts и тестов. */
export async function createApp(opts: AppOptions): Promise<NestFastifyApplication> {
  const db = createDb(opts.databaseUrl);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(
      db,
      { publicUrl: opts.publicUrl, cookieSecure: opts.cookieSecure ?? false },
      { dataDir: opts.dataDir ?? './data', maxUploadMb: opts.maxUploadMb ?? 50 },
      { boss: false, ...opts.push, databaseUrl: opts.databaseUrl },
      opts.extraControllers,
      opts.collab,
    ),
    new FastifyAdapter({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024 }),
    { logger: false },
  );
  // cast: у platform-fastify своя копия fastify другой минорной версии
  await app.register(multipart as never);
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  return app;
}
