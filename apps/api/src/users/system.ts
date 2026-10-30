import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { users } from '../db/schema.js';
import { publish } from './users.repo.js';

export const SYSTEM_LOGIN = 'automation';

/** System user (default "Automation"): idempotent; they cannot sign in (deactivated, hash invalid). */
export async function ensureSystemUser(
  db: Db,
  login = SYSTEM_LOGIN,
  name = 'Автоматизация',
): Promise<string> {
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({
        login,
        name,
        role: 'member',
        deactivatedAt: new Date().toISOString(),
        passwordHash: '!', // not an argon2 hash: verify is always false
      })
      .onConflictDoNothing({ target: users.login })
      .returning();
    if (!row) return undefined;
    await publish(tx, row.id, row);
    return row.id;
  });
  if (id) return id;
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.login, login));
  return u!.id;
}
