import { h } from 'vue';
import { defineWebModule } from '@planar/web/modules';

// лёгкая иконка: модуль не тянет lucide-vue-next
const Gantt = () =>
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
    [h('path', { d: 'M3 5h10M7 12h12M5 19h8' })],
  );

export const web = defineWebModule({
  id: 'timeline',
  views: [
    {
      id: 'timeline',
      label: { ru: 'Таймлайн', en: 'Timeline' },
      icon: Gantt,
      component: () => import('./TimelineView.vue'),
    },
  ],
});
