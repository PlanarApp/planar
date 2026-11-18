// PLNRAPP-500: the job of the engine «task control» — the cron pass of the reconcile, a parent woken by a subtask
// (event), or a manual pass of a workspace admin: reap of lost runs + reconcile + CI, all or one project.
import type { JobApi } from '@planar/server-kit';
import { reapPass } from './agent.js';
import { reconcilePass } from './engine.js';
import { sweep, tracked } from './monitor.js';

export interface TasksEngineData {
  trigger?: 'event' | 'manual';
  projectId?: string | null;
  userId?: string | null;
}

export async function tasksEngine(d: TasksEngineData, api: JobApi) {
  if (d.trigger !== 'manual') {
    await sweep(api.db);
    return tracked(
      api.db,
      { engine: 'tasks', job: 'reconcile', trigger: d.trigger === 'event' ? 'event' : 'cron' },
      (t) => reconcilePass(api, t),
    );
  }
  const projectId = d.projectId ?? null;
  await tracked(
    api.db,
    { engine: 'tasks', job: 'manual', projectId, trigger: 'manual', userId: d.userId ?? null },
    async (t) => {
      await t.step('ручной запуск: поиск упавших прогонов');
      await reapPass(api, t, projectId);
      await t.step('ручной запуск: сверка задач и CI');
      await reconcilePass(api, t, projectId);
    },
  );
}
