import { h } from 'vue';
import { defineWebModule } from '@planar/web/modules';

// лёгкая иконка-молния: модуль не тянет lucide-vue-next
const Zap = () =>
  h(
    'svg',
    {
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      width: 16,
      height: 16,
    },
    [h('path', { d: 'M13 2 3 14h9l-1 8 10-12h-9z' })],
  );

export const web = defineWebModule({
  id: 'sprints',
  views: [
    {
      id: 'sprint',
      label: { ru: 'Спринт', en: 'Sprint' },
      icon: Zap,
      component: () => import('./SprintView.vue'),
    },
  ],
  taskPanels: [
    {
      id: 'cycle',
      label: { ru: 'Спринт', en: 'Sprint' },
      icon: Zap,
      component: () => import('./CyclePanel.vue'),
    },
  ],
});
