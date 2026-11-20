import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ORIGIN } from './auth.js';

// the endpoint does not touch the DB: the test runs without a test database
const NO_DB = 'postgres://postgres:postgres@127.0.0.1:1/none';

async function get() {
  const app = await createApp({ databaseUrl: NO_DB, publicUrl: ORIGIN });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const res = await app
    .getHttpAdapter()
    .getInstance()
    .inject({ method: 'GET', url: '/api/version' });
  await app.close();
  return res;
}

describe('GET /api/version', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('без авторизации, без env сборки → 200 со значениями по умолчанию', async () => {
    for (const k of ['APP_COMMIT_SHA', 'APP_REF', 'APP_TAG', 'APP_BUILT_AT']) vi.stubEnv(k, '');
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ commit: 'dev', ref: 'dev', tag: null, builtAt: 'dev' });
  });

  it('env сборки из образа → в ответе', async () => {
    vi.stubEnv('APP_COMMIT_SHA', 'abc123');
    vi.stubEnv('APP_REF', 'main');
    vi.stubEnv('APP_TAG', 'v1.2.3');
    vi.stubEnv('APP_BUILT_AT', '2026-11-18T12:00:00Z');
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      commit: 'abc123',
      ref: 'main',
      tag: 'v1.2.3',
      builtAt: '2026-11-18T12:00:00Z',
    });
  });
});
