import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { settings } from '../db/schema.js';
import { installed } from './installed.js';

/** Db or transaction. */
export type Reader = Pick<Db, 'select'>;

/**
 * Enabled installed modules: read on every request (no cache, one query by PK),
 * so a change of settings.enabled_modules takes effect immediately and without restart.
 */
export async function enabledModules(q: Reader): Promise<Set<string>> {
  const [r] = await q.select().from(settings).where(eq(settings.id, 'enabled_modules'));
  const v = r?.value;
  const ids = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return new Set(ids.filter((id) => installed.some((m) => m.api.id === id)));
}
