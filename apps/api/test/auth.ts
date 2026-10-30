import { randomUUID } from 'node:crypto';
import { users } from '../src/db/schema.js';
import type { Db } from '../src/db/index.js';
import { createSession } from '../src/auth/sessions.js';

/** publicUrl of the test app. */
export const ORIGIN = 'http://localhost:5173';

export async function createUser(
  db: Db,
  o: { login?: string; role?: 'owner' | 'admin' | 'member' | 'guest'; name?: string } = {},
) {
  const login = o.login ?? `user_${randomUUID().slice(0, 12)}`;
  const [u] = await db
    .insert(users)
    .values({ login, name: o.name ?? login, role: o.role ?? 'member', passwordHash: 'x' })
    .returning();
  return u!;
}

export async function loginCookie(db: Db, userId: string) {
  return `planar_sid=${await createSession(db, userId)}`;
}
