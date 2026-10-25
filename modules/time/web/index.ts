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
      component: () => import('./TimerPanel.vue'),
    },
  ],
  topbar: [{ id: 'timer', order: 10, component: () => import('./TopbarTimer.vue') }],
  nav: [
    {
      id: 'week',
      order: 50,
      label: { ru: 'Мои часы', en: 'My hours' },
      icon: Clock,
      to: '/m/time/week',
    },
  ],
});
