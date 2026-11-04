import { Clock } from 'lucide-vue-next';
import { db, defineWebModule } from '@planar/web/modules';

export const web = defineWebModule({
  id: 'time',
  routes: [{ path: '/m/time/week', component: () => import('./WeekPage.vue') }],
  taskPanels: [
    {
      id: 'timer',
      label: { ru: 'Время', en: 'Time' },
      icon: Clock,
      order: 50,
      count: (taskId) => db.table('timeEntries').where('taskId').equals(taskId).count(),
      component: () => import('./TimerPanel.vue'),
    },
  ],
  groupTabs: [
    {
      id: 'week',
      tab: 'reports',
      order: 20,
      label: { ru: 'Время', en: 'Time' },
      component: () => import('./GroupTime.vue'),
    },
  ],
  topbar: [{ id: 'timer', order: 10, component: () => import('./TopbarTimer.vue') }],
});
