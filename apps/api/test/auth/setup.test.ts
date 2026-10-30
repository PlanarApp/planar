import { describe, expect, it } from 'vitest';
import { req, useApp } from './harness.js';

useApp();

describe('setup', () => {
  it('demo-login вне demo-режима → 404', async () => {
    expect((await req('POST', '/api/auth/demo-login')).statusCode).toBe(404);
  });

  it('needed true → гонка двух setup: один 201 → needed false → повтор 409', async () => {
    expect((await req('GET', '/api/setup')).json()).toMatchObject({
      needed: true,
      tokenRequired: false,
      demo: false,
    });
    const body = (l: string) => ({ login: l, name: 'Owner', password: 'password1' });
    const rs = await Promise.all([
      req('POST', '/api/setup', { body: body('boss1') }),
      req('POST', '/api/setup', { body: body('boss2') }),
    ]);
    expect(rs.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const ok = rs.find((r) => r.statusCode === 201)!;
    expect(ok.json().user.role).toBe('owner');
    expect(ok.json().user).not.toHaveProperty('passwordHash');
    expect(ok.headers['set-cookie']).toBeUndefined();
    expect(rs.find((r) => r.statusCode === 409)!.json().code).toBe('conflict');
    expect((await req('GET', '/api/setup')).json()).toMatchObject({ needed: false });
    expect((await req('POST', '/api/setup', { body: body('boss3') })).statusCode).toBe(409);
  });
});
