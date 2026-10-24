import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { users } from '../db/schema.js';
import { publish } from './users.repo.js';

export const SYSTEM_LOGIN = 'automation';

/** Системный пользователь (по умолчанию «Автоматизация»): идемпотентно; входить им нельзя (деактивирован, хэш невалиден). */
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
        passwordHash: '!', // не argon2-хэш: verify всегда false
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
