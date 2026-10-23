import { Module } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { defineMutator, uuidv7, type BackendModuleManifest } from '@planar/shared';
import { close, shared, todayIn } from '../shared/index.js';
import { sprintsCycles, sprintsSettings } from './schema.js';

@Module({})
class SprintsModule {}

// Структурный минимум JobApi (apps/api/src/modules/hooks.ts): зависимость от @planar/api не добавляем.
interface JobApi {
  db: NodePgDatabase;
  systemUserId: string;
  execute(
    userId: string,
    muts: { name: string; args: unknown }[],
    opts?: { system?: boolean },
  ): Promise<void>;
  enqueue(queue: string, data: object, opts?: { singletonKey?: string }): Promise<void>;
}

/** Закрытие цикла на сервере: строка цикла блокируется до конца транзакции — перенос ровно один раз. */
const lockedClose = defineMutator({
  ...close,
  async run(tx, a, ctx) {
    const q = (tx as unknown as { q?: { execute(s: unknown): Promise<unknown> } }).q;
    await q?.execute(sql`select id from sprints_cycles where id = ${a.id} for update`);
    return close.run(tx, a, ctx);
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
      await api.execute(
        api.systemUserId,
        [{ name: 'sprints.close', args: { id: data.cycleId, nextId: uuidv7() } }],
        { system: true },
      );
    },
  },
];

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: SprintsModule,
  mutators: shared.mutators.map((d) => (d.name === close.name ? lockedClose : d)),
  entities: shared.entities,
  jobs,
};
