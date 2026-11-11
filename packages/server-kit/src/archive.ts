import { sql, type SQL } from 'drizzle-orm';
import type { JobApi } from './hooks.js';

/** PLNRAPP-154: archived rows live this long, then the purge jobs delete them (the project's Archive banner says so). */
export const ARCHIVE_DAYS = 30;
/** `archived_at < ${archiveCutoff}` — archived longer than ARCHIVE_DAYS. */
export const archiveCutoff: SQL = sql`now() - make_interval(days => ${ARCHIVE_DAYS})`;

/**
 * Deletes the rows found by `ids` (a select of an `id` column), one mutation (one transaction) each, as the system user;
 * a row that fails (already gone with its parent, a broken one) does not stop the rest.
 */
export async function purgeArchived(api: JobApi, mutator: string, ids: SQL): Promise<void> {
  for (const r of (await api.db.execute(ids)).rows)
    await api
      .execute(api.systemUserId, [{ name: mutator, args: { id: r.id } }], { system: true })
      .catch(() => {});
}
