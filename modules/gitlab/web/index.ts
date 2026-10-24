import { defineComponent, h } from 'vue';
import { defineWebModule } from '@planar/web/modules';

// иконка без lucide: ветвление (merge request)
const Branch = defineComponent({
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
      [
        h('circle', { cx: 6, cy: 5, r: 2 }),
        h('circle', { cx: 6, cy: 19, r: 2 }),
        h('circle', { cx: 18, cy: 12, r: 2 }),
        h('path', { d: 'M6 7v10M8 12h8' }),
      ],
    ),
});

export const web = defineWebModule({
  id: 'gitlab',
  taskPanels: [
    {
      id: 'mrs',
      label: { ru: 'GitLab', en: 'GitLab' },
      icon: Branch,
      order: 60,
      component: () => import('./MrPanel.vue'),
    },
  ],
  settings: [
    {
      id: 'settings',
      label: { ru: 'GitLab', en: 'GitLab' },
      icon: Branch,
      adminOnly: true,
      component: () => import('./GitlabSettings.vue'),
    },
  ],
});
