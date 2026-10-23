import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { installed } from './installed.js';

/** Db или транзакция. */
export type Reader = Pick<Db, 'select'>;

/**
 * Включённые установленные модули: читается на каждый запрос (без кеша, один запрос по PK),
 * поэтому смена settings.enabled_modules действует сразу и без перезапуска.
 */
export async function enabledModules(q: Reader): Promise<Set<string>> {
  const [r] = await q.select().from(settings).where(eq(settings.id, 'enabled_modules'));
  const v = r?.value;
  const ids = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return new Set(ids.filter((id) => installed.some((m) => m.api.id === id)));
}
