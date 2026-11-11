import { sql } from 'drizzle-orm';
import { archiveCutoff, purgeArchived } from '@planar/server-kit';
import type { JobApi, JobDef } from '../modules/hooks.js';

/** PLNRAPP-154: archived tasks older than ARCHIVE_DAYS; roots only — task.delete takes the subtree with it. */
export const archivePurge: JobDef = {
  queue: 'core.archive.purge',
  cron: '20 3 * * *',
  handler: (_: unknown, api: JobApi) =>
    purgeArchived(
      api,
      'task.delete',
      sql`select t.id from tasks t where t.archived_at < ${archiveCutoff} and not exists
        (select 1 from tasks p where p.id = t.parent_id and p.archived_at < ${archiveCutoff})`,
    ),
};
