import { Controller, Post } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { authenticateRaw } from '../src/auth/auth.js';
import { hashToken } from '../src/auth/sessions.js';
import { sessions, users } from '../src/db/schema.js';
import { ORIGIN, createUser, loginCookie } from './auth.js';
import { db, getApp, useApp } from './auth/harness.js';

@Controller('api/_probe')
class Probe {
  @Post()
  post() {
    return { ok: true };
  }
}

const req = (method: 'GET' | 'POST', url: string, headers: Record<string, string> = {}) =>
  getApp().getHttpAdapter().getInstance().inject({ method, url, headers });
const sid = (cookie: string) => hashToken(cookie.split('=')[1]!);

useApp({ extraControllers: [Probe] });

describe('AuthGuard', () => {
  it('без cookie → 401', async () => {
    const res = await req('GET', '/api/auth/me');
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('unauthenticated');
  });

  it('валидная сессия → /me 200 без password_hash', async () => {
    const u = await createUser(db);
    const res = await req('GET', '/api/auth/me', { cookie: await loginCookie(db, u.id) });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(u.id);
    expect(res.json().user).not.toHaveProperty('passwordHash');
    expect(res.json().user.createdAt).toMatch(/Z$/);
  });

  it('истёкшая → 401 и строка удалена', async () => {
    const u = await createUser(db);
    const cookie = await loginCookie(db, u.id);
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(sessions.id, sid(cookie)));
    expect((await req('GET', '/api/auth/me', { cookie })).statusCode).toBe(401);
    expect(
      await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sid(cookie))),
    ).toHaveLength(0);
  });

  it('деактивированный → 401 и сессии удалены', async () => {
    const u = await createUser(db);
    const cookie = await loginCookie(db, u.id);
    await db
      .update(users)
      .set({ deactivatedAt: new Date().toISOString() })
      .where(eq(users.id, u.id));
    expect((await req('GET', '/api/auth/me', { cookie })).statusCode).toBe(401);
    expect(await db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(0);
  });

  it('осталось < 15 дней → продление и новый Set-Cookie', async () => {
    const u = await createUser(db);
    const cookie = await loginCookie(db, u.id);
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() + 5 * 86400_000).toISOString() })
      .where(eq(sessions.id, sid(cookie)));
    const res = await req('GET', '/api/auth/me', { cookie });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=2592000');
    const [s] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sid(cookie)));
    expect(Date.parse(s!.expiresAt) - Date.now()).toBeGreaterThan(29 * 86400_000);
  });

  it('POST с cookie без Origin → 403 origin_mismatch', async () => {
    const cookie = await loginCookie(db, (await createUser(db)).id);
    const res = await req('POST', '/api/_probe', { cookie });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('origin_mismatch');
  });

  it('POST с чужим Origin → 403', async () => {
    const cookie = await loginCookie(db, (await createUser(db)).id);
    const res = await req('POST', '/api/_probe', { cookie, origin: 'http://evil.example' });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('origin_mismatch');
  });

  it('POST с верным Origin → не 403', async () => {
    const cookie = await loginCookie(db, (await createUser(db)).id);
    const res = await req('POST', '/api/_probe', { cookie, origin: ORIGIN });
    expect(res.statusCode).toBe(201);
  });

  it('@Public health без cookie → 200', async () => {
    expect((await req('GET', '/api/health')).statusCode).toBe(200);
  });

  it('authenticateRaw UPGRADE: чужой Origin → отказ, верный → ctx', async () => {
    const u = await createUser(db, { role: 'admin' });
    const cookie = await loginCookie(db, u.id);
    const opts = { publicUrl: ORIGIN };
    await expect(
      authenticateRaw(db, { cookie, origin: 'http://evil.example' }, 'UPGRADE', opts),
    ).rejects.toMatchObject({ code: 'origin_mismatch' });
    expect(await authenticateRaw(db, { cookie, origin: ORIGIN }, 'UPGRADE', opts)).toMatchObject({
      userId: u.id,
      role: 'admin',
      via: 'session',
    });
  });
});
