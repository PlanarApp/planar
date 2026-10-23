import 'reflect-metadata';
import type { Type } from '@nestjs/common';
import multipart from '@fastify/multipart';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { HttpErrorFilter } from './auth/errors.js';
import { createDb } from './db/index.js';
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
  /** только тесты: дополнительные контроллеры */
  extraControllers?: Type[];
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
      opts.extraControllers,
    ),
    new FastifyAdapter({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024 }),
    { logger: false },
  );
  // cast: у platform-fastify своя копия fastify другой минорной версии
  await app.register(multipart as never);
  app.useGlobalFilters(new ErrorFilter(), new HttpErrorFilter());
  app.enableShutdownHooks();
  const close = app.close.bind(app);
  app.close = async () => {
    await close();
    await db.$client.end();
  };
  return app;
}
