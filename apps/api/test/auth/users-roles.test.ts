import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { projectMembers, spaceMembers } from '../../src/db/schema.js';
import { ensureRootSpace } from '../../src/spaces/root.js';
import { mkProject, mkSpace, mkUser, services, TestClient } from '../sync/helpers.js';
import { createUser, loginCookie } from '../auth.js';
import { db, req, useApp } from './harness.js';

useApp();

// аудит ролей 2026-11-26: админа создаёт и назначает только владелец; гость инстанса не выше guest; уход из Воркспейса
const as = async (role: 'owner' | 'admin' | 'member' | 'guest') => {
  const u = await createUser(db, { role });
  return { u, cookie: await loginCookie(db, u.id) };
};
const newUser = (cookie: string, login: string, role: string) =>
  req('POST', '/api/users', { cookie, body: { login, name: login, password: 'password1', role } });
const patch = (cookie: string, id: string, body: object) =>
  req('PATCH', `/api/users/${id}`, { cookie, body });
const roleIn = async (spaceId: string, userId: string) =>
  (
    await db
      .select({ role: spaceMembers.role })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)))
  )[0]?.role;

describe('admin — только владелец', () => {
  it('admin не создаёт admin и не повышает до admin; owner — может', async () => {
    const admin = await as('admin');
    const owner = await as('owner');
    expect((await newUser(admin.cookie, 'adm_by_admin', 'admin')).statusCode).toBe(403);
    expect((await newUser(admin.cookie, 'mem_by_admin', 'member')).statusCode).toBe(201);
    const t = await createUser(db);
    expect((await patch(admin.cookie, t.id, { role: 'admin' })).statusCode).toBe(403);
    expect((await patch(owner.cookie, t.id, { role: 'admin' })).statusCode).toBe(200);
    expect((await newUser(owner.cookie, 'adm_by_owner', 'admin')).statusCode).toBe(201);
  });
});

describe('гость инстанса — не выше guest', () => {
  it('понижение до guest опускает роли в кастомных спейсах и проектах', async () => {
    const admin = await as('admin');
    const t = await createUser(db);
    const sp = await mkSpace(db, admin.u.id, { [admin.u.id]: 'admin', [t.id]: 'member' });
    const pr = await mkProject(db, sp);
    await db
      .insert(projectMembers)
      .values({ spaceId: sp, projectId: pr, userId: t.id, role: 'member' });
    expect((await patch(admin.cookie, t.id, { role: 'guest' })).statusCode).toBe(200);
    expect(await roleIn(sp, t.id)).toBe('guest');
    const [pm] = await db.select().from(projectMembers).where(eq(projectMembers.userId, t.id));
    expect(pm!.role).toBe('guest');
  });
});

describe('уход из Воркспейса', () => {
  it('деактивация убирает из Воркспейса, custom-спейсов и их проектов; inherit-спейс следует', async () => {
    const admin = await as('admin');
    const t = await createUser(db);
    const root = await ensureRootSpace(db);
    const own = await mkSpace(db, admin.u.id, { [admin.u.id]: 'admin', [t.id]: 'admin' });
    const pr = await mkProject(db, own);
    await db
      .insert(projectMembers)
      .values({ spaceId: own, projectId: pr, userId: t.id, role: 'member' });
    const c = new TestClient(services(db), admin.u.id);
    const inh = uuidv7();
    await c.ok('space.create', { id: inh, name: 'I', rank: 'a9', memberId: uuidv7() });
    await c.ok('space.setMembersMode', { spaceId: inh, mode: 'inherit' });
    expect(await roleIn(root, t.id)).toBe('member');
    expect(await roleIn(inh, t.id)).toBe('member');

    expect((await patch(admin.cookie, t.id, { deactivated: true })).statusCode).toBe(200);
    expect(await roleIn(root, t.id)).toBeUndefined();
    expect(await roleIn(own, t.id)).toBeUndefined();
    expect(await roleIn(inh, t.id)).toBeUndefined();
    expect(await db.select().from(projectMembers).where(eq(projectMembers.userId, t.id))).toEqual(
      [],
    );
  });

  it('member.remove корневой строки убирает из custom-спейса', async () => {
    const admin = await mkUser(db, 'admin');
    const t = await mkUser(db, 'member');
    const root = await ensureRootSpace(db);
    const own = await mkSpace(db, admin, { [admin]: 'admin', [t]: 'member' });
    const c = new TestClient(services(db), admin);
    const [row] = await db
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, root), eq(spaceMembers.userId, t)));
    await c.ok('member.remove', { id: row!.id });
    expect(await roleIn(own, t)).toBeUndefined();
  });
});
