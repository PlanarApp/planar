import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { spaceMembers, spaces, users } from '../db/schema.js';

/** Db or transaction. */
type R = Pick<Db, 'select'>;

/**
 * Spaces the user sees: their memberships; instance owners and admins — every space (the SQL rule `can_see_space`,
 * migration 0096). The role in a space they are not a member of is admin (ServerTx.spaceRole).
 */
export async function mySpaceIds(q: R, userId: string): Promise<string[]> {
  const [u] = await q.select({ role: users.role }).from(users).where(eq(users.id, userId));
  const rows =
    u?.role === 'owner' || u?.role === 'admin'
      ? await q.select({ id: spaces.id }).from(spaces)
      : await q
          .select({ id: spaceMembers.spaceId })
          .from(spaceMembers)
          .where(eq(spaceMembers.userId, userId));
  return rows.map((r) => r.id);
}
