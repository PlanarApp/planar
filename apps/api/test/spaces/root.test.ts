import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from '@planar/shared';
import { spaceMembers } from '../../src/db/schema.js';
import { ensureRootSpace } from '../../src/spaces/root.js';
import { mkUser, newDb, services, taskArgs, TestClient, world } from '../sync/helpers.js';

const db = newDb();
afterAll(() => db.$client.end());
const role = async (spaceId: string, userId: string) =>
  (
    await db
      .select({ role: spaceMembers.role })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)))
  )[0]?.role;

describe('корневое пространство', () => {
  it('идемпотентно; участники — все, кроме гостей; админ инстанса — admin; проекты нельзя', async () => {
    const admin = await mkUser(db, 'admin');
    const member = await mkUser(db, 'member');
    const guest = await mkUser(db, 'guest');
    const id = await ensureRootSpace(db);
    expect(await ensureRootSpace(db)).toBe(id);
    expect(await role(id, admin)).toBe('admin');
    expect(await role(id, member)).toBe('member');
    expect(await role(id, guest)).toBeUndefined();
    const c = new TestClient(services(db), admin);
    expect(
      await c.push('project.create', {
        id: uuidv7(),
        spaceId: id,
        name: 'X',
        key: 'ROOTX',
        rank: 'a0',
      }),
    ).toMatchObject({ code: 'invalid_args' });
    expect(await c.push('space.delete', { id, withContent: true })).toMatchObject({
      code: 'invalid_args',
    });
  });

  it('space.delete withContent: пространство с проектами, задачами и уведомлениями удаляется', async () => {
    const w = await world(db);
    const t = taskArgs(w);
    await w.member.ok('task.create', t);
    await w.member.ok('task.assign', { id: uuidv7(), taskId: t.id, userId: w.admin.userId }); // уведомление admin
    expect(await w.admin.push('space.delete', { id: w.spaceId })).toMatchObject({
      code: 'conflict',
    });
    await w.admin.ok('space.delete', { id: w.spaceId, withContent: true });
    const d = (await w.admin.bootstrap()).data;
    expect(d.spaces!.some((s) => s.id === w.spaceId)).toBe(false);
    expect(d.tasks!.some((x) => x.id === t.id)).toBe(false);
    expect((d.notifications ?? []).some((n) => n.spaceId === w.spaceId)).toBe(false);
  });
});
