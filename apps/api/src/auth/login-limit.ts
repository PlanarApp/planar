import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { loginAttempts } from '../db/schema.js';
import { HttpError } from './errors.js';

const MAX = 10;
const stale = sql`${loginAttempts.windowStartedAt} < now() - interval '1 minute'`;

/** Уже больше 10 неудач за минуту → 429 (до проверки пароля). */
export async function assertNotLimited(db: Db, key: string) {
  const [r] = await db
    .select({ n: loginAttempts.attempts })
    .from(loginAttempts)
    .where(sql`${loginAttempts.key} = ${key} and not (${stale})`);
  if (r && r.n > MAX) throw tooMany();
}

/** Учесть неудачу; 11-я и далее → 429. */
export async function recordFailure(db: Db, key: string) {
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
