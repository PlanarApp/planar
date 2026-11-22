import { defineComponent, h } from 'vue';
import { db, defineWebModule } from '@planar/web/modules';
import type { Plugin } from '../shared/index.js';

// icon without lucide: puzzle block
const Puzzle = defineComponent({
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
      [h('rect', { x: 3, y: 3, width: 18, height: 18, rx: 3 }), h('path', { d: 'M9 3v18M3 9h18' })],
    ),
});

export const web = defineWebModule({
  id: 'plugins',
  routes: [{ path: '/m/plugins/p/:pluginId', component: () => import('./Page.vue') }],
  nav: [{ id: 'pages', order: 90, section: () => import('./Section.vue') }],
  taskPanels: [
    {
      id: 'panel',
      label: { ru: 'Плагины', en: 'Plugins' },
      icon: Puzzle,
      order: 90,
      // enabled plugins with a task panel; 0 — the tab is hidden
      count: async () =>
        ((await db.table('pluginsPlugins').toArray()) as Plugin[]).filter(
          (p) => p.enabled && p.points.taskPanel,
        ).length,
      component: () => import('./Panel.vue'),
    },
  ],
  settings: [
    {
      id: 'admin',
      label: { ru: 'Плагины', en: 'Plugins' },
      icon: Puzzle,
      adminOnly: true,
      component: () => import('./Admin.vue'),
    },
  ],
});
