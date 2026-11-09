import { apiTokenCreatedSchema } from '@planar/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { sessions, users } from '../../src/db/schema.js';
import { createUser, loginCookie } from '../auth.js';
import { db, req, useApp } from './harness.js';

useApp();

const as = (cookie: string, userId: string, headers?: Record<string, string>) =>
  req('POST', '/api/auth/impersonate', { cookie, body: { userId }, headers });

describe('PLNRAPP-129 войти под пользователем', () => {
  it('админ → участник: новая сессия участника, сессия админа удалена', async () => {
    const admin = await createUser(db, { role: 'admin' });
    const member = await createUser(db, { role: 'member' });
    const cookie = await loginCookie(db, admin.id);
    const r = await as(cookie, member.id);
    expect(r.statusCode).toBe(200);
    expect(r.json().user.id).toBe(member.id);
    const next = String(r.headers['set-cookie']).split(';')[0]!;
    expect((await req('GET', '/api/auth/me', { cookie: next })).json().user.id).toBe(member.id);
    expect((await req('GET', '/api/auth/me', { cookie })).statusCode).toBe(401);
    expect(await db.select().from(sessions).where(eq(sessions.userId, admin.id))).toHaveLength(0);
  });

  it('только вниз по роли: админ не входит под админом и владельцем, владелец — под админом', async () => {
    const owner = await createUser(db, { role: 'owner' });
    const admin = await createUser(db, { role: 'admin' });
    const admin2 = await createUser(db, { role: 'admin' });
    for (const target of [admin2, owner, admin]) {
      const r = await as(await loginCookie(db, admin.id), target.id);
      expect(r.statusCode).toBe(403);
    }
    expect((await as(await loginCookie(db, owner.id), admin.id)).statusCode).toBe(200);
  });

  it('участник не может; деактивированный и неизвестный — 404', async () => {
    const member = await createUser(db, { role: 'member' });
    const guest = await createUser(db, { role: 'guest' });
    expect((await as(await loginCookie(db, member.id), guest.id)).statusCode).toBe(403);
    const admin = await createUser(db, { role: 'admin' });
    const gone = await createUser(db, { role: 'member' });
    await db
      .update(users)
      .set({ deactivatedAt: new Date().toISOString() })
      .where(eq(users.id, gone.id));
    expect((await as(await loginCookie(db, admin.id), gone.id)).statusCode).toBe(404);
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await as(await loginCookie(db, admin.id), missing)).statusCode).toBe(404);
  });

  it('по API-токену админа — нельзя', async () => {
    const admin = await createUser(db, { role: 'admin' });
    const member = await createUser(db, { role: 'member' });
    const cookie = await loginCookie(db, admin.id);
    const t = apiTokenCreatedSchema.parse(
      (await req('POST', '/api/tokens', { cookie, body: { name: 't', scope: 'write' } })).json(),
    );
    const r = await req('POST', '/api/auth/impersonate', {
      body: { userId: member.id },
      origin: null,
      headers: { authorization: `Bearer ${t.secret}` },
    });
    expect(r.statusCode).toBe(403);
  });
});
