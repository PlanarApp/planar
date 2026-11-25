import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from '@planar/shared';
import { spaceMembers } from '../../src/db/schema.js';
import { ensureRootSpace } from '../../src/spaces/root.js';
import { mkUser, newDb, services, TestClient } from '../sync/helpers.js';

const db = newDb();
afterAll(() => db.$client.end());
const row = async (spaceId: string, userId: string) =>
  (
    await db
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)))
  )[0];
const role = async (spaceId: string, userId: string) => (await row(spaceId, userId))?.role;

// состав спейса: inherit зеркалит Воркспейс (корневое пространство), custom — свой список
describe('space.setMembersMode', () => {
  it('inherit → зеркало Воркспейса, изменения Воркспейса подтягиваются, custom — свой состав', async () => {
    const admin = await mkUser(db, 'admin');
    const a = await mkUser(db, 'member');
    const b = await mkUser(db, 'member');
    const guest = await mkUser(db, 'guest');
    const root = await ensureRootSpace(db);
    const c = new TestClient(services(db), admin);
    const sp = uuidv7();
    await c.ok('space.create', { id: sp, name: 'S', rank: 'a1', memberId: uuidv7() });
    await c.ok('member.add', { id: uuidv7(), spaceId: sp, userId: guest, role: 'guest' });
    expect(await role(sp, a)).toBeUndefined();

    // корневое пространство — источник
    expect(await c.push('space.setMembersMode', { spaceId: root, mode: 'inherit' })).toMatchObject({
      code: 'invalid_args',
    });
    await c.ok('space.setMembersMode', { spaceId: sp, mode: 'inherit' });
    expect(await role(sp, a)).toBe('member');
    expect(await role(sp, admin)).toBe('admin');
    expect(await role(sp, guest)).toBeUndefined(); // не из Воркспейса — убран
    // состав наследуется: ручные правки запрещены
    expect(
      await c.push('member.add', { id: uuidv7(), spaceId: sp, userId: guest, role: 'guest' }),
    ).toMatchObject({ code: 'conflict' });
    expect(await c.push('member.remove', { id: (await row(sp, a))!.id })).toMatchObject({
      code: 'conflict',
    });
    // изменения Воркспейса доходят до наследующих спейсов
    const late = await mkUser(db, 'member');
    await ensureRootSpace(db);
    expect(await role(sp, late)).toBe('member');
    await c.ok('member.remove', { id: (await row(root, b))!.id });
    expect(await role(sp, b)).toBeUndefined();
    await c.ok('member.update', { id: (await row(root, a))!.id, role: 'guest' });
    expect(await role(sp, a)).toBe('guest');

    // custom: нужен непустой состав с admin
    expect(await c.push('space.setMembersMode', { spaceId: sp, mode: 'custom' })).toMatchObject({
      code: 'invalid_args',
    });
    await c.ok('space.setMembersMode', {
      spaceId: sp,
      mode: 'custom',
      members: [
        { id: uuidv7(), userId: admin, role: 'admin' },
        { id: uuidv7(), userId: guest, role: 'guest' },
      ],
    });
    expect(await role(sp, a)).toBeUndefined();
    expect(await role(sp, guest)).toBe('guest');
    await c.ok('member.update', { id: (await row(root, a))!.id, role: 'member' });
    expect(await role(sp, a)).toBeUndefined(); // custom Воркспейс не трогает
  });

  it('не участник спейса режим не меняет', async () => {
    const owner = await mkUser(db, 'member');
    const other = await mkUser(db, 'member');
    await ensureRootSpace(db);
    const c = new TestClient(services(db), owner);
    const sp = uuidv7();
    await c.ok('space.create', { id: sp, name: 'S2', rank: 'a2', memberId: uuidv7() });
    const r = await new TestClient(services(db), other).push('space.setMembersMode', {
      spaceId: sp,
      mode: 'inherit',
    });
    expect(r).toMatchObject({ code: expect.stringMatching(/forbidden|not_found/) });
  });
});
