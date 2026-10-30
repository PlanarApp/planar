import { h } from 'vue';
import { defineWebModule } from '@planar/web/modules';

// icon without lucide: link
const Icon = () =>
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
    [
      h('path', {
        d: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
      }),
    ],
  );

export const web = defineWebModule({
  id: 'forms',
  settings: [
    {
      id: 'forms',
      level: 'project',
      label: { ru: 'Формы', en: 'Forms' },
      icon: Icon,
      adminOnly: true,
      component: () => import('./FormsSettings.vue'),
    },
  ],
});
