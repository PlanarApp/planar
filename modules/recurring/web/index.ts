import { Repeat } from 'lucide-vue-next';
import { db, defineWebModule } from '@planar/web/modules';

export const web = defineWebModule({
  id: 'recurring',
  taskPanels: [
    {
      id: 'repeat',
      label: { ru: 'Повтор', en: 'Repeat' },
      icon: Repeat,
      order: 70,
      count: (taskId) => db.table('recurringRules').where('taskId').equals(taskId).count(),
      component: () => import('./RepeatPanel.vue'),
    },
  ],
});
