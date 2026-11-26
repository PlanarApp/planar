import { Zap } from '@lucide/vue';
import type { Row } from '@planar/shared';
import { db, defineWebModule } from '@planar/web/modules';

export const web = defineWebModule({
  id: 'sprints',
  // a sprint — in the group's «Reports» (previously — a project view)
  groupTabs: [
    {
      id: 'sprint',
      tab: 'reports',
      order: 40,
      label: { ru: 'Спринты', en: 'Sprints' },
      component: () => import('./GroupSprint.vue'),
    },
  ],
  taskPanels: [
    {
      id: 'cycle',
      label: { ru: 'Спринт', en: 'Sprint' },
      icon: Zap,
      property: true,
      // filled — the task is in a cycle (PLNRAPP-830: an empty row goes under the task form's cut)
      count: async (taskId) =>
        (await db.table<Row<'tasks'>>('tasks').get(taskId))?.cycleId ? 1 : 0,
      component: () => import('./CyclePanel.vue'),
    },
  ],
});
