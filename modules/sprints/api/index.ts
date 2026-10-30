import { Module } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { JobApi } from '@planar/server-kit';
import { uuidv7, type BackendModuleManifest } from '@planar/shared';
import { shared, todayIn } from '../shared/index.js';
import { sprintsCycles, sprintsSettings } from './schema.js';

@Module({})
class SprintsModule {}

/** Closing the cycle on the server. No for update: the lock order (row → global advisory) is the reverse of the manual path and gives a deadlock; a parallel run catches the date overlap (conflict) after the advisory lock. */
const closeCycle = (api: JobApi, id: string, nextId: string) =>
  api.execute(api.systemUserId, [{ name: 'sprints.close', args: { id, nextId } }], {
    system: true,
    async prepare(q) {
      const r = await q.execute(sql`select closed_at from sprints_cycles where id = ${id}`);
      // the cycle does not exist or is already closed by a parallel run
      if (!r.rows[0] || r.rows[0].closed_at) return false;
    },
  });

const due = (endDate: string, timezone?: string) => endDate < todayIn(timezone ?? 'UTC');

const jobs = [
  {
    queue: 'sprints.close-due',
    cron: '*/10 * * * *',
    async handler(_: unknown, api: JobApi) {
      const rows = await api.db
        .select({
          id: sprintsCycles.id,
          endDate: sprintsCycles.endDate,
          tz: sprintsSettings.timezone,
        })
        .from(sprintsCycles)
        .innerJoin(sprintsSettings, eq(sprintsSettings.id, sprintsCycles.projectId))
        .where(and(isNull(sprintsCycles.closedAt), eq(sprintsSettings.enabled, true)));
      for (const r of rows)
        if (due(r.endDate, r.tz))
          await api.enqueue('sprints.close-cycle', { cycleId: r.id }, { singletonKey: r.id });
    },
  },
  {
    queue: 'sprints.close-cycle',
    retryLimit: 3,
    retryDelay: 30,
    async handler(data: { cycleId: string }, api: JobApi) {
      const [r] = await api.db
        .select({
          closedAt: sprintsCycles.closedAt,
          endDate: sprintsCycles.endDate,
          tz: sprintsSettings.timezone,
        })
        .from(sprintsCycles)
        .innerJoin(sprintsSettings, eq(sprintsSettings.id, sprintsCycles.projectId))
        .where(eq(sprintsCycles.id, data.cycleId));
      // the date could have shifted after the task was enqueued
      if (!r || r.closedAt || !due(r.endDate, r.tz)) return;
      await closeCycle(api, data.cycleId, uuidv7());
    },
  },
];

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: SprintsModule,
  mutators: shared.mutators,
  entities: shared.entities,
  jobs,
};
