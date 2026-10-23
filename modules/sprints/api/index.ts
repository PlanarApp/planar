import { Module } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { JobApi } from '@planar/server-kit';
import { uuidv7, type BackendModuleManifest } from '@planar/shared';
import { shared, todayIn } from '../shared/index.js';
import { sprintsCycles, sprintsSettings } from './schema.js';

@Module({})
class SprintsModule {}

/** Закрытие цикла на сервере: строка цикла блокируется (prepare) до конца транзакции — перенос ровно один раз. */
const closeCycle = (api: JobApi, id: string, nextId: string) =>
  api.execute(api.systemUserId, [{ name: 'sprints.close', args: { id, nextId } }], {
    system: true,
    async prepare(q) {
      const r = await q.execute(
        sql`select closed_at from sprints_cycles where id = ${id} for update`,
      );
      // цикла нет или уже закрыт параллельным прогоном
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
      // дата могла сдвинуться после постановки задачи
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
