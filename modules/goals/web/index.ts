import { defineComponent, h } from 'vue';
import { defineWebModule } from '@planar/web/modules';

// Иконка без зависимости от lucide: флажок
const Flag = defineComponent({
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
      [h('path', { d: 'M5 21V4M5 4h12l-2 4 2 4H5' })],
    ),
});

export const web = defineWebModule({
  id: 'goals',
  routes: [{ path: '/m/goals/', component: () => import('./GoalsPage.vue') }],
  nav: [
    {
      id: 'page',
      order: 70,
      label: { ru: 'Цели', en: 'Goals' },
      icon: Flag,
      to: '/m/goals/',
    },
  ],
  views: [
    {
      id: 'milestones',
      label: { ru: 'Вехи', en: 'Milestones' },
      icon: Flag,
      component: () => import('./MilestonesView.vue'),
    },
  ],
  taskPanels: [
    {
      id: 'milestone',
      label: { ru: 'Веха', en: 'Milestone' },
      icon: Flag,
      component: () => import('./MilestonePanel.vue'),
    },
  ],
});
