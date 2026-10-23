import { Module } from '@nestjs/common';
import type { ModuleHookApi } from '@planar/server-kit';
import type { BackendModuleManifest, MutationWrite } from '@planar/shared';
import { shared } from '../shared/index.js';

@Module({})
class TimeModule {}

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: TimeModule,
  mutators: shared.mutators,
  entities: shared.entities,
  // удаление задачи (в т.ч. подзадач — отдельные writes) уносит записи времени и оценку
  async afterMutation(writes: MutationWrite[], _ctx, api: ModuleHookApi) {
    for (const w of writes) {
      if (w.entity !== 'tasks' || w.op !== 'del' || !w.before) continue;
      const taskId = w.before.id as string;
      const e = 'timeEntries' as never;
      const rows = (await api.sys.scan(e, { index: 'taskId', eq: taskId })) as { id: string }[];
      for (const r of rows) await api.sys.del(e, r.id);
      await api.sys.del('timeEstimates' as never, taskId);
    }
  },
};
