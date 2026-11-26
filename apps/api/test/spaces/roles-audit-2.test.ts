import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from '@planar/shared';
import { projectMembers, spaceMembers, users } from '../../src/db/schema.js';
import { ensureRootSpace } from '../../src/spaces/root.js';
import { publish } from '../../src/users/users.repo.js';
import {
  key,
  mkProject,
  mkSpace,
  mkUser,
  newDb,
  services,
  taskArgs,
  TestClient,
  world,
} from '../sync/helpers.js';

// аудит ролевой модели, часть 2 (docs/contracts/core.md «Roles and access»)
const db = newDb();
afterAll(() => db.$client.end());
const role = async (spaceId: string, userId: string) =>
  (
    await db
      .select({ role: spaceMembers.role })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)))
  )[0]?.role;

describe('роль ограничена ролью инстанса', () => {
  it('гость инстанса: member.add/update, setMembersMode и projectMember выше guest — отказ', async () => {
    const w = await world(db);
    const g = await mkUser(db, 'guest');
    const add = (r: string) =>
      w.admin.push('member.add', { id: uuidv7(), spaceId: w.spaceId, userId: g, role: r });
    expect(await add('member')).toMatchObject({ code: 'invalid_args' });
    expect(await add('admin')).toMatchObject({ code: 'invalid_args' });
    await w.admin.ok('member.add', { id: uuidv7(), spaceId: w.spaceId, userId: g, role: 'guest' });
    const [row] = await db.select().from(spaceMembers).where(eq(spaceMembers.userId, g));
    expect(await w.admin.push('member.update', { id: row!.id, role: 'member' })).toMatchObject({
      code: 'invalid_args',
    });
    expect(
      await w.admin.push('space.setMembersMode', {
        spaceId: w.spaceId,
        mode: 'custom',
        members: [
          { id: uuidv7(), userId: w.admin.userId, role: 'admin' },
          { id: uuidv7(), userId: g, role: 'member' },
        ],
      }),
    ).toMatchObject({ code: 'invalid_args' });
    // в проекте — тот же потолок (гость пространства — не выше guest)
    await w.admin.ok('project.setMembersMode', {
      projectId: w.projectId,
      mode: 'custom',
      members: [
        { id: uuidv7(), userId: w.admin.userId, role: 'admin' },
        { id: uuidv7(), userId: g, role: 'guest' },
      ],
    });
    expect(
      await w.admin.push('projectMember.setRole', {
        id: (await db.select().from(projectMembers).where(eq(projectMembers.userId, g)))[0]!.id,
        role: 'member',
      }),
    ).toMatchObject({ code: 'invalid_args' });
  });

  it('inherit: гость инстанса, оказавшийся в Воркспейсе member, отражается как guest', async () => {
    const admin = await mkUser(db, 'admin');
    const g = await mkUser(db, 'guest');
    const root = await ensureRootSpace(db);
    await db.insert(spaceMembers).values({ spaceId: root, userId: g, role: 'member' }); // устаревшие данные
    const c = new TestClient(services(db), admin);
    const sp = uuidv7();
    await c.ok('space.create', { id: sp, name: 'S', rank: 'a1', memberId: uuidv7() });
    await c.ok('space.setMembersMode', { spaceId: sp, mode: 'inherit' });
    expect(await role(sp, g)).toBe('guest');
  });

  it('миграция 0096 приводит устаревшие строки к потолку', async () => {
    const admin = await mkUser(db, 'admin');
    const g = await mkUser(db, 'guest');
    const sp = await mkSpace(db, admin, { [admin]: 'admin', [g]: 'admin' });
    const pr = await mkProject(db, sp);
    await db
      .insert(projectMembers)
      .values({ spaceId: sp, projectId: pr, userId: g, role: 'member' });
    const sql = readFileSync(
      new URL('../../drizzle/0096_roles_audit.sql', import.meta.url),
      'utf8',
    ).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
    for (const part of sql.split('--> statement-breakpoint')) await db.$client.query(part);
    expect(await role(sp, g)).toBe('guest');
    expect(
      (await db.select().from(projectMembers).where(eq(projectMembers.userId, g)))[0]!.role,
    ).toBe('guest');
    expect(await role(sp, admin)).toBe('admin');
  });
});

describe('project.update / archive / delete — admin проекта; create — member спейса', () => {
  it('member спейса создаёт проект, но не меняет, не архивирует и не удаляет; admin спейса — да', async () => {
    const w = await world(db);
    const pid = uuidv7();
    await w.member.ok('project.create', {
      id: pid,
      spaceId: w.spaceId,
      name: 'M',
      key: key(),
      rank: 'a5',
    });
    expect(
      await w.guest.push('project.create', {
        id: uuidv7(),
        spaceId: w.spaceId,
        name: 'G',
        key: key(),
        rank: 'a6',
      }),
    ).toMatchObject({ code: 'forbidden' });
    expect(await w.member.push('project.update', { id: pid, name: 'X' })).toMatchObject({
      code: 'forbidden',
    });
    expect(
      await w.member.push('project.update', { id: pid, archivedAt: '2026-11-26T10:00:00.000Z' }),
    ).toMatchObject({ code: 'forbidden' });
    expect(await w.member.push('project.delete', { id: pid })).toMatchObject({
      code: 'forbidden',
    });
    await w.admin.ok('project.update', { id: pid, name: 'Y' });
    await w.admin.ok('project.delete', { id: pid });
  });

  it('custom-проект: admin проекта (member спейса) меняет, member проекта — нет', async () => {
    const w = await world(db);
    const other = await mkUser(db, 'member');
    await w.admin.ok('member.add', {
      id: uuidv7(),
      spaceId: w.spaceId,
      userId: other,
      role: 'member',
    });
    await w.admin.ok('project.setMembersMode', {
      projectId: w.projectId,
      mode: 'custom',
      members: [
        { id: uuidv7(), userId: w.admin.userId, role: 'admin' },
        { id: uuidv7(), userId: w.member.userId, role: 'admin' },
        { id: uuidv7(), userId: other, role: 'member' },
      ],
    });
    await w.member.ok('project.update', { id: w.projectId, name: 'By project admin' });
    const o = new TestClient(services(db), other);
    expect(await o.push('project.update', { id: w.projectId, name: 'No' })).toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('админ инстанса видит все спейсы', () => {
  it('bootstrap, pull, права admin спейса — без членства; обычный member не видит', async () => {
    const w = await world(db);
    const root = await ensureRootSpace(db);
    const inst = await mkUser(db, 'admin');
    const a = new TestClient(services(db), inst);
    const tid = uuidv7();
    await w.admin.ok('task.create', taskArgs(w, { id: tid }));

    const boot = await a.bootstrap();
    const ids = (rows: unknown) => (rows as { id: string }[]).map((r) => r.id);
    expect(ids(boot.data.spaces)).toEqual(expect.arrayContaining([w.spaceId, root]));
    expect(ids(boot.data.tasks)).toContain(tid);
    expect(ids(boot.data.projects)).toContain(w.projectId);
    expect(ids((await w.outsider.bootstrap()).data.spaces)).not.toContain(w.spaceId);

    // новые данные чужого спейса доходят через pull
    const next = uuidv7();
    await w.admin.ok('task.create', taskArgs(w, { id: next }));
    const pulled = await a.pull(boot.cursor);
    expect(pulled.changes.some((c) => c.entity === 'tasks' && c.id === next)).toBe(true);

    // права — как admin спейса: задача, проект, состав
    await a.ok('task.create', taskArgs(w, { id: uuidv7() }));
    await a.ok('project.update', { id: w.projectId, name: 'By instance admin' });
    await a.ok('member.add', {
      id: uuidv7(),
      spaceId: w.spaceId,
      userId: w.outsider.userId,
      role: 'member',
    });
    expect(await role(w.spaceId, inst)).toBeUndefined();
  });
});

describe('email скрыт от гостя инстанса', () => {
  it('bootstrap и pull: чужой email — null, свой и у member — на месте', async () => {
    const w = await world(db);
    await db.update(users).set({ email: 'a@x.test' }).where(eq(users.id, w.admin.userId));
    await db.update(users).set({ email: 'g@x.test' }).where(eq(users.id, w.guest.userId));
    type U = { id: string; email: string | null };
    const email = (rows: unknown, id: string) => (rows as U[]).find((u) => u.id === id)?.email;
    const g = await w.guest.bootstrap();
    expect(email(g.data.users, w.admin.userId)).toBeNull();
    expect(email(g.data.users, w.guest.userId)).toBe('g@x.test');
    const m = await w.member.bootstrap();
    expect(email(m.data.users, w.admin.userId)).toBe('a@x.test');

    // правка пользователя в журнале: гость получает её без email
    const [row] = await db.select().from(users).where(eq(users.id, w.admin.userId));
    await db.transaction((q) => publish(q, w.admin.userId, row!));
    const sent = async (c: TestClient, cursor: number) =>
      (
        (await c.pull(cursor)).changes.find((x) => x.entity === 'users' && x.id === w.admin.userId)!
          .data as U
      ).email;
    expect(await sent(w.guest, g.cursor)).toBeNull();
    expect(await sent(w.member, m.cursor)).toBe('a@x.test');
  });
});

describe('мутаторы читают роль в проекте', () => {
  it('назначить исполнителем комментария можно только участника проекта', async () => {
    const w = await world(db);
    const tid = uuidv7();
    await w.admin.ok('task.create', taskArgs(w, { id: tid }));
    await w.admin.ok('project.setMembersMode', {
      projectId: w.projectId,
      mode: 'custom',
      members: [{ id: uuidv7(), userId: w.admin.userId, role: 'admin' }],
    });
    // участник пространства, но не проекта: исполнителем нельзя
    expect(
      await w.admin.push('comment.create', {
        id: uuidv7(),
        taskId: tid,
        body: { type: 'doc' },
        assigneeId: w.member.userId,
      }),
    ).toMatchObject({ code: 'invalid_args' });
  });
});
