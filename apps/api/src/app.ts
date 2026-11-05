import 'reflect-metadata';
import type { Type } from '@nestjs/common';
import multipart from '@fastify/multipart';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { setDemo } from '@planar/server-kit';
import { AppModule } from './app.module.js';
import { createDb } from './db/index.js';
import type { PushOpts } from './push/push.js';
import { observeRequest } from './metrics/metrics.js';
import { ErrorFilter } from './error.filter.js';

export interface AppOptions {
  databaseUrl: string;
  /** origin for Origin check and cookie */
  publicUrl: string;
  cookieSecure?: boolean;
  /** file storage root (DATA_DIR) */
  dataDir?: string;
  /** upload limit, MB (MAX_UPLOAD_MB) */
  maxUploadMb?: number;
  /** SETUP_TOKEN: set — POST /api/setup requires X-Setup-Token */
  setupToken?: string;
  /** DB_POOL_MAX */
  dbPoolMax?: number;
  /** DEMO_MODE and DEMO_RESET_HOURS */
  demo?: boolean;
  demoResetHours?: number;
  /** CLOUD_URL and CLOUD_TOKEN (docs/contracts/cloud-link.md) */
  cloud?: { url: string; token: string };
  /** pg-boss and Web Push; in tests without settings the queue is disabled */
  push?: Partial<Omit<PushOpts, 'databaseUrl'>>;
  /** tests only: extra controllers */
  extraControllers?: Type[];
  /** TRUST_PROXY: IP/CIDR of trusted proxies; empty — req.ip is the connection address */
  trustProxy?: string[];
  /** Fastify pino options; false — no logs (tests) */
  logger?: boolean | { level: string };
}

/** Shared factory for main.ts and tests. */
export async function createApp(opts: AppOptions): Promise<NestFastifyApplication> {
  setDemo(opts.demo ?? false);
  const db = createDb(opts.databaseUrl, opts.dbPoolMax);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(
      db,
      {
        publicUrl: opts.publicUrl,
        cookieSecure: opts.cookieSecure ?? false,
        setupToken: opts.setupToken,
        demo: opts.demo ?? false,
        demoResetHours: opts.demoResetHours ?? 24,
        cloud: opts.cloud,
      },
      { dataDir: opts.dataDir ?? './data', maxUploadMb: opts.maxUploadMb ?? 50 },
      { boss: false, ...opts.push, databaseUrl: opts.databaseUrl },
      opts.extraControllers,
    ),
    new FastifyAdapter({
      logger: opts.logger ?? false,
      bodyLimit: 1024 * 1024,
      ...(opts.trustProxy?.length ? { trustProxy: opts.trustProxy } : {}),
    }),
    { logger: false },
  );
  // cast: platform-fastify has its own copy of fastify of another minor version
  await app.register(multipart as never);
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onResponse', async (req, reply) => {
      const route = req.routeOptions?.url ?? 'unmatched';
      if (route === '/api/metrics' || route.startsWith('/api/health')) return;
      if (route === 'unmatched' && /^\/api\/(metrics|health)/.test(req.url)) return;
      observeRequest(req.method, route, reply.statusCode, reply.elapsedTime / 1000);
    });
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  return app;
}
