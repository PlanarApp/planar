import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { loginAttempts } from '../db/schema.js';
import { HttpError } from './errors.js';

const MAX = 10;
const stale = sql`${loginAttempts.windowStartedAt} < now() - interval '1 minute'`;

/**
 * Counts the attempt before the secret is checked (success resets it): the 11th in a minute → 429. Counting first —
 * parallel requests cannot all pass a check that reads the counter before any failure is written.
 */
export async function countAttempt(db: Db, key: string) {
  const [r] = await db
    .insert(loginAttempts)
    .values({ key, attempts: 1, windowStartedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: loginAttempts.key,
      set: {
        attempts: sql`case when ${stale} then 1 else ${loginAttempts.attempts} + 1 end`,
        windowStartedAt: sql`case when ${stale} then now() else ${loginAttempts.windowStartedAt} end`,
      },
    })
    .returning({ n: loginAttempts.attempts });
  if (r!.n > MAX) throw tooMany();
}

export const resetAttempts = (db: Db, key: string) =>
  db.delete(loginAttempts).where(eq(loginAttempts.key, key));

const tooMany = () =>
  new HttpError(429, 'rate_limited', 'Слишком много попыток входа, повторите позже');
