import { describe, expect, it } from 'vitest';
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';

useApp();

const get = (cookie: string, url = '/api/email/setup/config', extra: Record<string, string> = {}) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({ method: 'GET', url, headers: { cookie, origin: ORIGIN, ...extra } });

describe('pf4: setup выключенного модуля', () => {
  it('pf4: member → 403, admin → 200, owner → 200, без входа → 401', async () => {
    const as = async (role: 'member' | 'admin' | 'owner') =>
      loginCookie(db, (await createUser(db, { role })).id);
    expect((await get(await as('member'))).statusCode).toBe(403);
    expect((await get(await as('admin'))).statusCode).toBe(200);
    expect((await get(await as('owner'))).statusCode).toBe(200);
    expect((await get('')).statusCode).toBe(401);
  });

  it('pf4: Bearer admin → 403; остальные маршруты выключенного модуля — 404', async () => {
    const c = await loginCookie(db, (await createUser(db, { role: 'admin' })).id);
    const t = await getApp()
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/tokens',
        headers: { cookie: c, origin: ORIGIN },
        payload: { name: 't', scope: 'write' },
      });
    const secret = t.json().secret as string;
    expect(
      (await get('', '/api/email/setup/config', { authorization: `Bearer ${secret}` })).statusCode,
    ).toBe(403);
    expect((await get(c, '/api/email/unsubscribe')).statusCode).toBe(404);
    expect((await get(c, '/api/email/setupx')).statusCode).toBe(404);
  });
});
