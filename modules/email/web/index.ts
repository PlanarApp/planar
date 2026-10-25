import { defineComponent, h } from 'vue';
import { defineWebModule } from '@planar/web/modules';

// иконка без lucide: конверт
const Mail = defineComponent({
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
      [h('rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }), h('path', { d: 'm3 7 9 6 9-6' })],
    ),
});

export const web = defineWebModule({
  id: 'email',
  setup: () => import('./EmailSetup.vue'),
  settings: [
    {
      id: 'setup',
      label: { ru: 'Почта (SMTP)', en: 'Email (SMTP)' },
      icon: Mail,
      adminOnly: true,
      component: () => import('./EmailSetup.vue'),
    },
    {
      id: 'prefs',
      label: { ru: 'Email', en: 'Email' },
      icon: Mail,
      component: () => import('./EmailPrefs.vue'),
    },
  ],
});
