import { Module } from '@nestjs/common';
import type { BackendModuleManifest, MutationWrite } from '@planar/shared';
import { shared } from '../shared/index.js';

@Module({})
class TimeModule {}

/** Часть ModuleHookApi (@planar/api/modules), которая нужна хуку. */
interface HookApi {
  sys: {
    scan(e: never, o: { index: string; eq: unknown }): Promise<{ id: string }[]>;
    del(e: never, id: string): Promise<void>;
  };
}

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: TimeModule,
  mutators: shared.mutators,
  entities: shared.entities,
  // удаление задачи (в т.ч. подзадач — отдельные writes) уносит записи времени и оценку
  async afterMutation(writes: MutationWrite[], _ctx, api: HookApi) {
    for (const w of writes) {
      if (w.entity !== 'tasks' || w.op !== 'del' || !w.before) continue;
      const taskId = w.before.id as string;
      const e = 'timeEntries' as never;
      for (const r of await api.sys.scan(e, { index: 'taskId', eq: taskId }))
        await api.sys.del(e, r.id);
      await api.sys.del('timeEstimates' as never, taskId);
    }
  },
};
