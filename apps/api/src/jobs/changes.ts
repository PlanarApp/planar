import { sql } from 'drizzle-orm';
import type { JobApi, JobDef } from '../modules/hooks.js';

/** Days the changes journal is kept: an older cursor gets reset in pull and the client bootstraps (C-sync). */
export const CHANGES_DAYS = 30;
const CHUNK = 10_000;

/** PLNRAPP-253: old rows of the journal; the newest stays, so the pull cursor (max seq) does not go back. */
export const changesPurge: JobDef = {
  queue: 'core.changes.purge',
  cron: '40 3 * * *',
  handler: async (_: unknown, api: JobApi) => {
    // in chunks: the first run on a big base does not hold one huge delete
    for (;;) {
      const r = await api.db.execute(sql`delete from changes where seq in (select seq from changes
        where created_at < now() - make_interval(days => ${CHANGES_DAYS})
          and seq < (select max(seq) from changes) order by seq limit ${CHUNK})`);
      if ((r.rowCount ?? 0) < CHUNK) return;
    }
  },
};
