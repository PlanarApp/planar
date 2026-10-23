import { defineComponent, h } from 'vue';
import { defineWebModule } from '@planar/web/modules';

// Иконка без зависимости от lucide: часы
const Clock = defineComponent({
  props: { size: { type: [Number, String], default: 16 } },
  setup: (p) => () =>
    h(
      'svg',
      {
        width: p.size,
        height: p.size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
      },
      [h('circle', { cx: 12, cy: 12, r: 10 }), h('path', { d: 'M12 6v6l4 2' })],
    ),
});

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
