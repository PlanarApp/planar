import { defineComponent, h } from 'vue';
import { defineWebModule } from '@planar/web/modules';

// Иконка без зависимости от lucide: четыре плитки
const Grid = defineComponent({
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
        'stroke-linejoin': 'round',
      },
      [
        h('rect', { x: 3, y: 3, width: 7, height: 9 }),
        h('rect', { x: 14, y: 3, width: 7, height: 5 }),
        h('rect', { x: 14, y: 12, width: 7, height: 9 }),
        h('rect', { x: 3, y: 16, width: 7, height: 5 }),
      ],
    ),
});

export const web = defineWebModule({
  id: 'dashboards',
  routes: [
    { path: '/m/dashboards', component: () => import('./BoardsPage.vue') },
    { path: '/m/dashboards/:id', component: () => import('./BoardPage.vue') },
  ],
  nav: [
    {
      id: 'list',
      order: 60,
      label: { ru: 'Дашборды', en: 'Dashboards' },
      icon: Grid,
      to: '/m/dashboards',
    },
  ],
});
