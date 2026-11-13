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
  // deleting a task (including subtasks — separate writes) takes its time entries and estimate with it
  async afterMutation(writes: MutationWrite[], ctx, api: ModuleHookApi) {
    const e = 'timeEntries' as never;
    // merging tasks (PLNRAPP-117): their time entries go to the target — each new «duplicates» link names both
    if (ctx.mutator === 'task.merge')
      for (const w of writes) {
        if (w.entity !== 'taskLinks' || w.before || !w.after) continue;
        const rows = (await api.sys.scan(e, { index: 'taskId', eq: w.after.taskId })) as {
          id: string;
        }[];
        for (const r of rows) await api.sys.patch(e, r.id, { taskId: w.after.targetId } as never);
      }
    for (const w of writes) {
      if (w.entity !== 'tasks' || w.op !== 'del' || !w.before) continue;
      const taskId = w.before.id as string;
      const rows = (await api.sys.scan(e, { index: 'taskId', eq: taskId })) as { id: string }[];
      for (const r of rows) await api.sys.del(e, r.id);
      await api.sys.del('timeEstimates' as never, taskId);
    }
  },
};
