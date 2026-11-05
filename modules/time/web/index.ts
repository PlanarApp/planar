import { Clock } from 'lucide-vue-next';
import { defineWebModule } from '@planar/web/modules';

export const web = defineWebModule({
  id: 'time',
  routes: [{ path: '/m/time/week', component: () => import('./WeekPage.vue') }],
  taskPanels: [
    {
      id: 'timer',
      label: { ru: 'Время', en: 'Time' },
      icon: Clock,
      order: 50,
      // a properties row: start/stop + tracked time, the menu — entry form and list (PLANARAPP-42)
      property: true,
      card: true, // also on the cards of the views (PLANARAPP-43)
      component: () => import('./TimeControl.vue'),
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
