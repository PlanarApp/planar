import type { INestApplication } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ORIGIN } from './auth.js';
import { DB } from '../src/tokens.js';
import { testDbUrl } from './db.js';

async function get(
  databaseUrl: string,
  url = '/api/health',
  push = {},
  setup?: (app: INestApplication) => void,
) {
  const app = await createApp({ databaseUrl, publicUrl: ORIGIN, push });
  await app.init();
  setup?.(app);
  await app.getHttpAdapter().getInstance().ready();
  const res = await app.getHttpAdapter().getInstance().inject({ method: 'GET', url });
  await app.close();
  return res;
}

describe('GET /api/health', () => {
  it('БД доступна → 200 {ok, db: up}', async () => {
    const res = await get(testDbUrl());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: 'up' });
  });

  it('БД недоступна → 503 {ok: false, db: down}', async () => {
    const res = await get('postgres://postgres:postgres@127.0.0.1:1/none');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, db: 'down' });
  });

  it('неизвестный путь → формат C-http', async () => {
    const app = await createApp({ databaseUrl: testDbUrl(), publicUrl: ORIGIN });
    await app.init();
    const res = await app.getHttpAdapter().getInstance().inject({ method: 'GET', url: '/nope' });
    await app.close();
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not_found');
  });
});

describe('GET /api/health/ready', () => {
  it('всё в порядке, очередь выключена → 200 queue: off', async () => {
    const res = await get(testDbUrl(), '/api/health/ready');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: 'up', migrations: 'ok', queue: 'off' });
  });

  it('pg-boss запущен → queue: up', async () => {
    const res = await get(testDbUrl(), '/api/health/ready', { boss: true, worker: false });
    expect(res.statusCode).toBe(200);
    expect(res.json().queue).toBe('up');
  });

  it('БД недоступна → 503 db: down', async () => {
    const res = await get('postgres://postgres:postgres@127.0.0.1:1/none', '/api/health/ready');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, db: 'down' });
  });

  it('pg-boss не отвечает на пробе → 503 queue: down', async () => {
    const res = await get(
      testDbUrl(),
      '/api/health/ready',
      { boss: true, worker: false },
      (app) => {
        const pool = app.get(DB).$client;
        const real = pool.query.bind(pool);
        vi.spyOn(pool, 'query').mockImplementation((q: unknown, ...a: never[]) =>
          String(q).includes('pgboss') ? Promise.reject(new Error('down')) : real(q, ...a),
        );
      },
    );
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, db: 'up', migrations: 'ok', queue: 'down' });
  });
});
