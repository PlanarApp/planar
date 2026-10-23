import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { changes, fileUploads, files, sessions } from '../../src/db/schema.js';
import { createUser, loginCookie } from '../auth.js';
import { db, req, useApp } from './harness.js';

useApp();

const as = async (role: 'owner' | 'admin' | 'member' | 'guest') => {
  const u = await createUser(db, { role });
  return { u, cookie: await loginCookie(db, u.id) };
};
const newUser = (cookie: string, login: string, role = 'member') =>
  req('POST', '/api/users', { cookie, body: { login, name: login, password: 'password1', role } });
const patch = (cookie: string, id: string, body: object) =>
  req('PATCH', `/api/users/${id}`, { cookie, body });

describe('GET/POST /api/users', () => {
  it('member и guest → 403, без cookie → 401', async () => {
    for (const role of ['member', 'guest'] as const) {
      const { cookie } = await as(role);
      expect((await req('GET', '/api/users', { cookie })).statusCode).toBe(403);
      expect((await newUser(cookie, 'zzz1')).statusCode).toBe(403);
    }
    expect((await req('GET', '/api/users')).statusCode).toBe(401);
  });

  it('admin создаёт (201, без password_hash), в списке есть; вход новым работает', async () => {
    const { cookie } = await as('admin');
    const r = await newUser(cookie, 'NewGuy');
    expect(r.statusCode).toBe(201);
    expect(r.json().user.login).toBe('newguy');
    expect(r.json().user).not.toHaveProperty('passwordHash');
    const list = (await req('GET', '/api/users', { cookie })).json().users;
    expect(list.some((u: { login: string }) => u.login === 'newguy')).toBe(true);
    expect(list.every((u: object) => !('passwordHash' in u))).toBe(true);
    const l = await req('POST', '/api/auth/login', {
      body: { login: 'newguy', password: 'password1' },
      origin: null,
    });
    expect(l.statusCode).toBe(200);
  });

  it('дубль логина → 409; роль owner → 400; короткий пароль → 400', async () => {
    const { cookie } = await as('owner');
    expect((await newUser(cookie, 'dup1')).statusCode).toBe(201);
    expect((await newUser(cookie, 'dup1')).statusCode).toBe(409);
    expect((await newUser(cookie, 'own2', 'owner')).statusCode).toBe(400);
    const r = await req('POST', '/api/users', {
      cookie,
      body: { login: 'shortpw', name: 'x', password: 'short', role: 'member' },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('PATCH /api/users/:id', () => {
  it('admin меняет роль и имя member; owner назначить нельзя (400)', async () => {
    const { cookie } = await as('admin');
    const t = await createUser(db);
    const r = await patch(cookie, t.id, { role: 'guest', name: 'Новое' });
    expect(r.statusCode).toBe(200);
    expect(r.json().user).toMatchObject({ role: 'guest', name: 'Новое' });
    expect((await patch(cookie, t.id, { role: 'owner' })).statusCode).toBe(400);
  });

  it('admin не трогает owner и другого admin; owner трогает admin', async () => {
    const admin = await as('admin');
    const owner = await as('owner');
    const other = await createUser(db, { role: 'admin' });
    expect((await patch(admin.cookie, owner.u.id, { name: 'x' })).statusCode).toBe(403);
    expect((await patch(admin.cookie, other.id, { name: 'x' })).statusCode).toBe(403);
    expect((await patch(owner.cookie, other.id, { name: 'x' })).statusCode).toBe(200);
  });

  it('member чужой PATCH → 403', async () => {
    const { cookie } = await as('member');
    expect((await patch(cookie, (await createUser(db)).id, { name: 'x' })).statusCode).toBe(403);
  });

  it('себя: name/email/password можно; role и deactivated — 403', async () => {
    const { u, cookie } = await as('member');
    const ok = await patch(cookie, u.id, {
      name: 'Я',
      email: 'me@example.com',
      password: 'newpassword1',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user).toMatchObject({ name: 'Я', email: 'me@example.com' });
    expect((await patch(cookie, u.id, { role: 'admin' })).statusCode).toBe(403);
    expect((await patch(cookie, u.id, { deactivated: true })).statusCode).toBe(403);
  });

  it('owner меняет себе пароль и входит с новым', async () => {
    const { u, cookie } = await as('owner');
    await patch(cookie, u.id, { password: 'brandnewpass' });
    const l = await req('POST', '/api/auth/login', {
      body: { login: u.login, password: 'brandnewpass' },
      origin: null,
    });
    expect(l.statusCode).toBe(200);
  });

  it('деактивация удаляет сессии, вход 401; снятие — вход снова', async () => {
    const { cookie } = await as('admin');
    const t = (await newUser(cookie, 'target1')).json().user;
    const tCookie = await loginCookie(db, t.id);
    const r = await patch(cookie, t.id, { deactivated: true });
    expect(r.json().user.deactivatedAt).toMatch(/Z$/);
    expect(await db.select().from(sessions).where(eq(sessions.userId, t.id))).toHaveLength(0);
    expect((await req('GET', '/api/auth/me', { cookie: tCookie })).statusCode).toBe(401);
    const login = () =>
      req('POST', '/api/auth/login', {
        body: { login: 'target1', password: 'password1' },
        origin: null,
      });
    expect((await login()).statusCode).toBe(401);
    await patch(cookie, t.id, { deactivated: false });
    expect((await login()).statusCode).toBe(200);
  });

  it('несуществующий id → 404', async () => {
    const { cookie } = await as('admin');
    expect(
      (await patch(cookie, '00000000-0000-4000-8000-000000000000', { name: 'x' })).statusCode,
    ).toBe(404);
  });

  it('avatarFile: свой загруженный — ок, null снимает; чужой/несуществующий — 400', async () => {
    const { u, cookie } = await as('member');
    const mine = 'a'.repeat(64);
    const theirs = 'b'.repeat(64);
    const other = await createUser(db);
    for (const sha of [mine, theirs]) {
      await db.insert(files).values({ sha256: sha, size: 1, mime: 'image/png', createdBy: u.id });
    }
    await db.insert(fileUploads).values({ sha256: mine, userId: u.id });
    await db.insert(fileUploads).values({ sha256: theirs, userId: other.id });
    expect((await patch(cookie, u.id, { avatarFile: mine })).json().user.avatarFile).toBe(mine);
    expect((await patch(cookie, u.id, { avatarFile: theirs })).statusCode).toBe(400);
    expect((await patch(cookie, u.id, { avatarFile: 'c'.repeat(64) })).statusCode).toBe(400);
    expect((await patch(cookie, u.id, { avatarFile: null })).json().user.avatarFile).toBeNull();
  });
});

describe('changes', () => {
  it('создание и правка пишут users в changes без password_hash', async () => {
    const { cookie } = await as('admin');
    const u = (await newUser(cookie, 'chg1')).json().user;
    await patch(cookie, u.id, { name: 'Другое', password: 'newpassword1' });
    const rows = await db
      .select()
      .from(changes)
      .where(and(eq(changes.entity, 'users'), eq(changes.id, u.id)))
      .orderBy(changes.seq);
    expect(rows).toHaveLength(2);
    expect(rows[1]!.data).toMatchObject({ id: u.id, name: 'Другое' });
    for (const r of rows) expect(JSON.stringify(r.data)).not.toContain('asswordHash');
    expect(rows[0]!.spaceId).toBeNull();
  });
});
