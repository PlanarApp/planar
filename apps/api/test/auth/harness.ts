import type { Type } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { ORIGIN } from '../auth.js';
import { migrate, type Db } from '../../src/db/index.js';
import { createTestDb, dropDb, testDbUrl } from '../db.js';

export let db: Db;
// argon2 is slow under CI load
vi.setConfig({ testTimeout: 30_000, hookTimeout: 90_000 });
let app: Awaited<ReturnType<typeof createApp>>;

/** App on a file base; req(method, url, {cookie?, body?}) — with a correct Origin. */
export const getApp = () => app;

export function useApp({
  ownDb = true,
  extraControllers = [] as Type[],
  appOpts = {} as Partial<Parameters<typeof createApp>[0]>,
} = {}) {
  let url = testDbUrl();
  let drop: (() => Promise<void>) | undefined;
  beforeAll(async () => {
    if (ownDb) {
      // empty DB: setup is possible only with no users
      const base = new URL(url);
      const name = `planar_t_${randomBytes(6).toString('hex')}`;
      const admin = new pg.Client({ connectionString: base.toString() });
      await admin.connect();
      await admin.query(`create database ${name}`);
      base.pathname = `/${name}`;
      url = base.toString();
      const m = createTestDb(url);
      await migrate(m).finally(() => m.$client.end());
      drop = async () => {
        await dropDb(admin, name);
        await admin.end().catch(() => {});
      };
    }
    db = createTestDb(url);
    app = await createApp({ databaseUrl: url, publicUrl: ORIGIN, extraControllers, ...appOpts });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app.close();
    await db.$client.end();
    await drop?.();
    // drop database waits for all server backends — slow on a loaded server
  }, 90_000);
}

export const req = (
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  o: {
    cookie?: string;
    body?: unknown;
    origin?: string | null;
    headers?: Record<string, string>;
  } = {},
) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method,
      url,
      payload: o.body as object | undefined,
      headers: {
        ...o.headers,
        ...(o.cookie && { cookie: o.cookie }),
        ...(o.origin !== null && { origin: o.origin ?? ORIGIN }),
      },
    });
