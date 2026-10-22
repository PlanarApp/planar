import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { createDb } from './db/index.js';
import { ErrorFilter } from './error.filter.js';

export interface AppOptions {
  databaseUrl: string;
  /** опции pino Fastify; false — без логов (тесты) */
  logger?: boolean | { level: string };
}

/** Общая фабрика для main.ts и тестов. */
export async function createApp(opts: AppOptions): Promise<NestFastifyApplication> {
  const db = createDb(opts.databaseUrl);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(db),
    new FastifyAdapter({ logger: opts.logger ?? false, bodyLimit: 1024 * 1024 }),
    { logger: false },
  );
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  const close = app.close.bind(app);
  app.close = async () => {
    await close();
    await db.$client.end();
  };
  return app;
}
