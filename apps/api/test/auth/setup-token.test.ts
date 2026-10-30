import { describe, expect, it } from 'vitest';
import { db, getApp, req, useApp } from './harness.js';
import type { Db } from '../../src/db/index.js';
import { DB } from '../../src/tokens.js';
import { insertUser } from '../../src/users/users.repo.js';

useApp({ appOpts: { setupToken: 's3cret-token', dbPoolMax: 3, demo: true, demoResetHours: 6 } });

const body = { login: 'boss', name: 'Owner', password: 'password1' };
const post = (token?: string) =>
  req('POST', '/api/setup', {
    body,
    headers: token === undefined ? {} : { 'x-setup-token': token },
  });

describe('setup', () => {
  it('SETUP_TOKEN: GET → tokenRequired/demo; POST без токена и с неверным → 403, с верным → 201', async () => {
    expect((await req('GET', '/api/setup')).json()).toEqual({
      needed: true,
      tokenRequired: true,
      demo: true,
      demoResetHours: 6,
    });
    expect((await post()).statusCode).toBe(403);
    expect((await post('wrong-token-xx')).statusCode).toBe(403);
    expect((await post('s3cret-token')).statusCode).toBe(201);
    expect((await req('GET', '/api/setup')).json().needed).toBe(false);
  });

  it('DB_POOL_MAX ограничивает pool.options.max', () => {
    const appDb = getApp().get<Db>(DB, { strict: false });
    expect((appDb.$client as unknown as { options: { max: number } }).options.max).toBe(3);
  });

  it('demo-login: demo включён → сессия пользователя demo; без пользователя → 404', async () => {
    expect((await req('POST', '/api/auth/demo-login')).statusCode).toBe(404);
    await insertUser(db, { login: 'demo', name: 'Demo', role: 'member', passwordHash: '!' });
    const r = await req('POST', '/api/auth/demo-login');
    expect(r.statusCode).toBe(200);
    expect(r.json().user.login).toBe('demo');
    expect(r.headers['set-cookie']).toBeDefined();
  });
});
