import type { Type } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { ORIGIN } from '../auth.js';
import { migrate, type Db } from '../../src/db/index.js';
import { createTestDb, dropDb, testDbUrl } from '../db.js';

export let db: Db;
// argon2 под нагрузкой CI медленный
vi.setConfig({ testTimeout: 30_000, hookTimeout: 90_000 });
let app: Awaited<ReturnType<typeof createApp>>;

/** Приложение на базе файла; req(method, url, {cookie?, body?}) — с верным Origin. */
export const getApp = () => app;

export function useApp({ ownDb = true, extraControllers = [] as Type[] } = {}) {
  let url = testDbUrl();
  let drop: (() => Promise<void>) | undefined;
  beforeAll(async () => {
    if (ownDb) {
      // пустая база: setup возможен только без пользователей
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
    app = await createApp({ databaseUrl: url, publicUrl: ORIGIN, extraControllers });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app.close();
    await db.$client.end();
    await drop?.();
    // drop database ждёт все бэкенды сервера — на загруженном сервере долго
  }, 90_000);
}

export const req = (
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  o: { cookie?: string; body?: unknown; origin?: string | null } = {},
) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method,
      url,
      payload: o.body as object | undefined,
      headers: {
        ...(o.cookie && { cookie: o.cookie }),
        ...(o.origin !== null && { origin: o.origin ?? ORIGIN }),
      },
    });
