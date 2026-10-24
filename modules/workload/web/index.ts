import { defineComponent, h } from 'vue';
import { defineWebModule } from '@planar/web/modules';

// Иконка без зависимости от lucide: столбцы
const Bars = defineComponent({
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
      },
      [h('path', { d: 'M6 20V10M12 20V4M18 20v-6' })],
    ),
});

export const web = defineWebModule({
  id: 'workload',
  routes: [{ path: '/m/workload/', component: () => import('./WorkloadPage.vue') }],
  nav: [
    {
      id: 'page',
      order: 60,
      label: { ru: 'Загрузка', en: 'Workload' },
      icon: Bars,
      to: '/m/workload/',
    },
  ],
});
