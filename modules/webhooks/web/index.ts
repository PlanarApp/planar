import { h } from 'vue';
import { defineWebModule } from '@planar/web/modules';

// иконка без lucide: колокольчик
const Bell = () =>
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
    [h('path', { d: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0' })],
  );

export const web = defineWebModule({
  id: 'webhooks',
  settings: [
    {
      id: 'webhooks',
      label: { ru: 'Вебхуки', en: 'Webhooks' },
      icon: Bell,
      component: () => import('./WebhooksSettings.vue'),
    },
  ],
});
