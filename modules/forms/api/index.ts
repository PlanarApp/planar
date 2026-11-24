import { Module } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { JobApi } from '@planar/server-kit';
import type { BackendModuleManifest } from '@planar/shared';
import { shared } from '../shared/index.js';
import { FormsController } from './controller.js';

/** rate-limit windows (a row per IP) and expired personal links only grew */
async function cleanup(_: unknown, api: JobApi) {
  await api.db.execute(
    sql`delete from forms_rate_limits where window_started_at < now() - interval '1 day'`,
  );
  await api.db.execute(sql`delete from forms_links where expires_at < now() - interval '30 days'`);
}

@Module({ controllers: [FormsController] })
class FormsModule {}

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: FormsModule,
  mutators: shared.mutators,
  entities: shared.entities,
  jobs: [{ queue: 'forms.cleanup', cron: '20 3 * * *', handler: cleanup }],
};
