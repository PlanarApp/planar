import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ORIGIN } from './auth.js';
import { testDbUrl } from './db.js';

async function get(databaseUrl: string) {
  const app = await createApp({ databaseUrl, publicUrl: ORIGIN });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const res = await app
    .getHttpAdapter()
    .getInstance()
    .inject({ method: 'GET', url: '/api/health' });
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
