import { Module } from '@nestjs/common';
import type { BackendModuleManifest } from '@planar/shared';
import type { ModuleHookApi, MutationWrite } from '@planar/server-kit';
import { shared } from '../shared/index.js';

@Module({})
class GoalsModule {}

/** Deleting a task or changing its project takes the milestone row with it (C-modules hook). */
async function afterMutation(writes: MutationWrite[], _ctx: unknown, api: ModuleHookApi) {
  for (const w of writes) {
    if (w.entity !== 'tasks' || !w.before) continue;
    const gone = w.op === 'del' || w.after?.projectId !== w.before.projectId;
    if (!gone) continue;
    const e = 'goalsMilestoneTasks' as never;
    const rows = (await api.sys.scan(e, { index: 'taskId', eq: w.before.id })) as { id: string }[];
    for (const r of rows) await api.sys.del(e, r.id);
  }
}

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: GoalsModule,
  mutators: shared.mutators,
  entities: shared.entities,
  afterMutation: afterMutation as BackendModuleManifest['afterMutation'],
};
