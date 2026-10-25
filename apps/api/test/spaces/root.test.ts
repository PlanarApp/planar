import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from '@planar/shared';
import { spaceMembers } from '../../src/db/schema.js';
import { ensureRootSpace } from '../../src/spaces/root.js';
import { mkUser, newDb, services, TestClient } from '../sync/helpers.js';

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
  });
});
