import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { users } from '../db/schema.js';
import { publish } from './users.repo.js';

export const SYSTEM_LOGIN = 'automation';

/**
 * System user (default "Automation"): idempotent; they cannot sign in (deactivated, hash invalid).
 * bot — the AI bot (PLNRAPP-167): active (the token works, rights of a member), sign-in is rejected by `users.bot`.
 * db — a connection or a transaction (inside a module hook — a savepoint).
 */
export async function ensureSystemUser(
  db: Pick<Db, 'transaction' | 'select'>,
  login = SYSTEM_LOGIN,
  name = 'Автоматизация',
  bot = false,
): Promise<string> {
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({
        login,
        name,
        role: 'member',
        deactivatedAt: bot ? null : new Date().toISOString(),
        bot,
        passwordHash: '!', // not an argon2 hash: verify is always false
      })
      .onConflictDoNothing({ target: users.login })
      .returning();
    if (!row) return undefined;
    await publish(tx, row.id, row);
    return row.id;
  });
  if (id) return id;
  const [u] = await db
    .select({ id: users.id, bot: users.bot })
    .from(users)
    .where(eq(users.login, login));
  if (bot && !u!.bot) throw new Error(`логин ${login} занят обычным пользователем`);
  return u!.id;
}
