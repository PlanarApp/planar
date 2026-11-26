import { sql } from 'drizzle-orm';
import type { JobApi, JobDef } from '../modules/hooks.js';

/** Expired sessions (deleted only when presented), WebAuthn challenges and stale login counters (a key per tried login): both only grew. */
export const authPurge: JobDef = {
  queue: 'core.auth.purge',
  cron: '50 3 * * *',
  handler: async (_: unknown, api: JobApi) => {
    await api.db.execute(sql`delete from sessions where expires_at < now()`);
    await api.db.execute(sql`delete from auth_challenges where expires_at < now()`);
    await api.db.execute(
      sql`delete from login_attempts where window_started_at < now() - interval '1 day'`,
    );
  },
};
