import { and, eq, isNull, ne } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import { uuidv7 } from '@planar/shared';
import type { Db } from '../db/index.js';
import { settings, spaceMembers, spaces, users } from '../db/schema.js';
import { executeMutations } from '../sync/mutate.js';
import { ensureSystemUser } from '../users/system.js';

/** id of the setting with the root space — the «Workspace» level (documents and chats for everyone). */
export const ROOT_SPACE = 'root_space';

/**
 * Root space: created on first start; all active users except guests are
 * members (instance owners and admins are space admins). Idempotent: call on start
 * and after a user is created or a role changes. `changed` — a user whose instance role was just changed:
 * their Workspace role is set to the one their instance role gives (admin / member / guest), so a demoted
 * admin does not stay an admin of the Workspace; instance admins are always promoted to admin.
 */
export async function ensureRootSpace(db: Db, changed?: string): Promise<string> {
  const sys = await ensureSystemUser(db);
  const [row] = await db.select().from(settings).where(eq(settings.id, ROOT_SPACE));
  let id = typeof row?.value === 'string' ? row.value : undefined;
  if (id && !(await db.select({ id: spaces.id }).from(spaces).where(eq(spaces.id, id))).length)
    id = undefined; // the setting was left over from a deleted space
  if (!id) {
    id = uuidv7();
    const [first] = await db
      .select({ rank: spaces.rank })
      .from(spaces)
      .orderBy(spaces.rank)
      .limit(1);
    await executeMutations(
      db,
      sys,
      [
        {
          name: 'space.create',
          args: {
            id,
            name: 'Общее',
            rank: generateKeyBetween(null, first?.rank ?? null),
            memberId: uuidv7(),
          },
        },
        { name: 'settings.set', args: { id: ROOT_SPACE, value: id } },
      ],
      undefined,
      undefined,
      { system: true },
    );
  }
  const people = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(and(isNull(users.deactivatedAt), ne(users.role, 'guest')));
  const have = new Set(
    (
      await db
        .select({ userId: spaceMembers.userId })
        .from(spaceMembers)
        .where(eq(spaceMembers.spaceId, id))
    ).map((m) => m.userId),
  );
  await syncRoles(db, sys, id, changed);
  const add = people.filter((p) => !have.has(p.id));
  if (add.length)
    await executeMutations(
      db,
      sys,
      add.map((p) => ({
        name: 'member.add',
        args: {
          id: uuidv7(),
          spaceId: id,
          userId: p.id,
          role: p.role === 'owner' || p.role === 'admin' ? 'admin' : 'member',
        },
      })),
      undefined,
      undefined,
      { system: true },
    );
  return id;
}

const canonical = (role: string) =>
  role === 'owner' || role === 'admin' ? 'admin' : role === 'guest' ? 'guest' : 'member';

/** Existing Workspace members: instance admins → admin; the `changed` user → exactly their instance role. */
async function syncRoles(db: Db, sys: string, root: string, changed?: string) {
  const rows = await db
    .select({
      id: spaceMembers.id,
      userId: spaceMembers.userId,
      role: spaceMembers.role,
      u: users.role,
    })
    .from(spaceMembers)
    .innerJoin(users, eq(users.id, spaceMembers.userId))
    .where(and(eq(spaceMembers.spaceId, root), isNull(users.deactivatedAt)));
  const upd = rows
    .map((r) => ({
      id: r.id,
      role: r.userId === changed ? canonical(r.u) : canonical(r.u) === 'admin' ? 'admin' : r.role,
      was: r.role,
    }))
    .filter((r) => r.role !== r.was)
    // promotions first: the last admin stays one while the others are demoted
    .sort((a, b) => Number(b.role === 'admin') - Number(a.role === 'admin'));
  if (upd.length)
    await executeMutations(
      db,
      sys,
      upd.map((r) => ({ name: 'member.update', args: { id: r.id, role: r.role } })),
      undefined,
      undefined,
      { system: true },
    );
}
