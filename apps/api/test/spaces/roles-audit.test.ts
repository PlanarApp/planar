import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from '@planar/shared';
import { spaceMembers, users } from '../../src/db/schema.js';
import { ensureRootSpace } from '../../src/spaces/root.js';
import { mkUser, newDb, world } from '../sync/helpers.js';

// аудит ролевой модели (docs/contracts/core.md «Roles and access»): регрессии найденных дыр
const db = newDb();
afterAll(() => db.$client.end());
const rootRole = async (root: string, userId: string) =>
  (
    await db
      .select({ role: spaceMembers.role })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, root), eq(spaceMembers.userId, userId)))
  )[0]?.role;
const setRole = (id: string, role: 'owner' | 'admin' | 'member' | 'guest') =>
  db.update(users).set({ role }).where(eq(users.id, id));

describe('роль в корневом пространстве следует за ролью инстанса', () => {
  it('понижение admin → member и → guest снимает admin в Воркспейсе, повышение даёт admin', async () => {
    const a = await mkUser(db, 'admin');
    const b = await mkUser(db, 'member');
    const root = await ensureRootSpace(db);
    expect(await rootRole(root, a)).toBe('admin');
    await setRole(a, 'member');
    await ensureRootSpace(db, a);
    expect(await rootRole(root, a)).toBe('member');
    await setRole(a, 'guest');
    await ensureRootSpace(db, a);
    expect(await rootRole(root, a)).toBe('guest');
    await setRole(b, 'admin');
    await ensureRootSpace(db, b);
    expect(await rootRole(root, b)).toBe('admin');
    // ручное повышение участника до admin Воркспейса не сбрасывается обычным вызовом
    const c = await mkUser(db, 'member');
    await ensureRootSpace(db);
    await db
      .update(spaceMembers)
      .set({ role: 'admin' })
      .where(and(eq(spaceMembers.spaceId, root), eq(spaceMembers.userId, c)));
    await ensureRootSpace(db);
    expect(await rootRole(root, c)).toBe('admin');
  });
});

describe('роль проекта и комментарии', () => {
  it('гость кастомного проекта (участник пространства) не назначает комментарий', async () => {
    const w = await world(db);
    const taskId = uuidv7();
    await w.admin.ok('task.create', {
      id: taskId,
      projectId: w.projectId,
      statusId: w.statusIds[1],
      title: 'T',
      rank: 'a0',
    });
    const commentId = uuidv7();
    await w.member.ok('comment.create', { id: commentId, taskId, body: { type: 'doc' } });
    await w.admin.ok('project.setMembersMode', {
      projectId: w.projectId,
      mode: 'custom',
      members: [
        { id: uuidv7(), userId: w.admin.userId, role: 'admin' },
        { id: uuidv7(), userId: w.member.userId, role: 'guest' },
      ],
    });
    expect(
      await w.member.push('comment.assign', { id: commentId, assigneeId: w.admin.userId }),
    ).toMatchObject({ code: 'forbidden' });
  });
});
