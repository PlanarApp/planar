import { Sparkles } from 'lucide-vue-next';
import { defineComponent, h } from 'vue';
import { defineWebModule, type WorkActivity } from '@planar/web/modules';
import type { AiActivity, AiTaskRunStatus, AiUsage } from '../shared/index.js';
import { call } from './api';

/** The same page on every level: the group settings pass spaceId / projectId, the level is fixed here. */
const page = (level: 'workspace' | 'space' | 'project') => async () => {
  const { default: AiSettings } = await import('./AiSettings.vue');
  return {
    default: defineComponent({
      props: { spaceId: String, projectId: String },
      setup: (p) => () => h(AiSettings, { level, spaceId: p.spaceId, projectId: p.projectId }),
    }),
  };
};
const label = { ru: 'ИИ', en: 'AI' };

/** PLNRAPP-202: the runs for the indicator; the error links to the «AI» tab of the task (panel 'runs'). */
const activity =
  (path: string) =>
  async (id: string): Promise<WorkActivity[]> => {
    // PLNRAPP-402: only the task's answer carries `usage` (the sum over its runs)
    const r = await call<{ activity: AiActivity[]; usage?: AiUsage }>(
      'GET',
      `activity/${path}/${id}`,
    );
    return r.activity.map((a) => ({
      ...a,
      usage: r.usage,
      panel: 'runs',
      cancel:
        a.state === 'queued' && !a.trigger ? () => call('POST', `queue/${a.id}/cancel`) : undefined,
    }));
  };
/** PLNRAPP-322: the AI status of the project's tasks (PLNRAPP-319) for the list rows and the board cards. */
const projectTasks = async (projectId: string): Promise<WorkActivity[]> =>
  (await call<{ statuses: AiTaskRunStatus[] }>('GET', `status/projects/${projectId}`)).statuses.map(
    (s) => ({
      id: s.runId,
      itemId: s.taskId,
      state: s.status,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      error: s.error,
      usage: s.usage,
      panel: 'runs',
    }),
  );

export const web = defineWebModule({
  id: 'ai',
  taskPanels: [
    {
      id: 'runs',
      label: { ru: 'ИИ', en: 'AI' },
      icon: Sparkles,
      order: 70,
      component: () => import('./TaskAiPanel.vue'),
    },
  ],
  activity: [
    { id: 'tasks', entity: 'tasks', load: activity('tasks') },
    { id: 'chat', entity: 'chatChannels', load: activity('channels') },
    { id: 'pages', entity: 'pages', load: activity('pages') },
    { id: 'projectTasks', entity: 'projects', load: projectTasks },
  ],
  groupTabs: [
    {
      id: 'ai',
      tab: 'reports',
      order: 30,
      label,
      component: () => import('./GroupAi.vue'),
    },
  ],
  docPanels: [{ id: 'harness', component: () => import('./HarnessPanel.vue') }],
  settings: [
    {
      id: 'workspace',
      level: 'workspace',
      label,
      icon: Sparkles,
      adminOnly: true,
      component: page('workspace'),
    },
    {
      id: 'tasks',
      level: 'workspace',
      label: { ru: 'Задачи ИИ', en: 'AI tasks' },
      icon: Sparkles,
      adminOnly: true,
      component: () => import('./AiMonitor.vue'),
    },
    { id: 'space', level: 'space', label, icon: Sparkles, component: page('space') },
    { id: 'project', level: 'project', label, icon: Sparkles, component: page('project') },
  ],
});
