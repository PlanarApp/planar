import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { sessions, users } from '../../src/db/schema.js';
import { hashPassword } from '../../src/auth/password.js';
import { createUser, loginCookie } from '../auth.js';
import { db, req, useApp } from './harness.js';

useApp();

const mkUser = async (login: string, password = 'password1', extra: object = {}) => {
  const [u] = await db
    .insert(users)
    .values({
      login,
      name: login,
      role: 'member',
      passwordHash: await hashPassword(password),
      ...extra,
    })
    .returning();
  return u!;
};
const login = (l: string, password = 'password1') =>
  req('POST', '/api/auth/login', { body: { login: l, password }, origin: null });

describe('setup', () => {
  it('needed true → гонка двух setup: один 201 → needed false → повтор 409', async () => {
    expect((await req('GET', '/api/setup')).json()).toEqual({ needed: true });
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
    expect((await req('GET', '/api/setup')).json()).toEqual({ needed: false });
    expect((await req('POST', '/api/setup', { body: body('boss3') })).statusCode).toBe(409);
  });
});

describe('login / logout', () => {
  it('вход: cookie и user без password_hash; логин регистронезависим', async () => {
    await mkUser('alice');
    const r = await login('ALICE');
    expect(r.statusCode).toBe(200);
    expect(String(r.headers['set-cookie'])).toMatch(/^planar_sid=.+HttpOnly/);
    expect(r.json().user.login).toBe('alice');
    expect(r.json().user).not.toHaveProperty('passwordHash');
  });

  it('вход → me работает; выход → cookie сброшена, сессия удалена, me 401', async () => {
    const u = await mkUser('bob');
    const cookie = String(((await login('bob')).headers['set-cookie'] as string).split(';')[0]);
    expect((await req('GET', '/api/auth/me', { cookie })).statusCode).toBe(200);
    const out = await req('POST', '/api/auth/logout', { cookie });
    expect(out.statusCode).toBe(204);
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
    expect(await db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(0);
    expect((await req('GET', '/api/auth/me', { cookie })).statusCode).toBe(401);
  });

  it('logout без cookie → 401', async () => {
    expect((await req('POST', '/api/auth/logout')).statusCode).toBe(401);
  });

  it('неверный пароль и неизвестный логин → 401 invalid_credentials', async () => {
    await mkUser('carol');
    for (const [l, p] of [
      ['carol', 'wrongpass1'],
      ['nobody', 'password1'],
    ] as const) {
      const r = await login(l, p);
      expect(r.statusCode).toBe(401);
      expect(r.json().code).toBe('invalid_credentials');
    }
  });

  it('деактивированный: вход 401, сессии удалены при деактивации (PATCH)', async () => {
    await mkUser('dave', 'password1', { deactivatedAt: new Date().toISOString() });
    expect((await login('dave')).statusCode).toBe(401);
  });

  it('плохое тело → 400 invalid_request с issues', async () => {
    const r = await req('POST', '/api/auth/login', { body: { login: 1 }, origin: null });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('invalid_request');
    expect(r.json().details.issues).toBeDefined();
  });
});

describe('лимит входа', () => {
  it('10 неудач → 401, 11-я → 429; верный пароль тоже 429; другой логин не затронут', async () => {
    await mkUser('erin');
    for (let i = 0; i < 10; i++) expect((await login('erin', 'badpassword')).statusCode).toBe(401);
    const r = await login('erin', 'badpassword');
    expect(r.statusCode).toBe(429);
    expect(r.json().code).toBe('rate_limited');
    expect((await login('erin')).statusCode).toBe(429);
    await mkUser('frank');
    expect((await login('frank')).statusCode).toBe(200);
  });

  it('успешный вход сбрасывает счётчик', async () => {
    await mkUser('gina');
    for (let i = 0; i < 9; i++) await login('gina', 'badpassword');
    expect((await login('gina')).statusCode).toBe(200);
    for (let i = 0; i < 10; i++) expect((await login('gina', 'badpassword')).statusCode).toBe(401);
    expect((await login('gina', 'badpassword')).statusCode).toBe(429);
  });
});

describe('Origin', () => {
  it('POST с cookie и чужим Origin → 403 origin_mismatch', async () => {
    const cookie = await loginCookie(db, (await createUser(db)).id);
    const r = await req('POST', '/api/auth/logout', { cookie, origin: 'http://evil.example' });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('origin_mismatch');
  });
});
