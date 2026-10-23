import { defineComponent, h } from 'vue';
import { defineWebModule, useRouter } from '@planar/web/modules';

// Иконка без зависимости от lucide: стрелка в лоток
const Upload = defineComponent({
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
      [h('path', { d: 'M12 3v12M7 8l5-5 5 5M4 21h16' })],
    ),
});

export const web = defineWebModule({
  id: 'import',
  routes: [{ path: '/m/import/', component: () => import('./ImportPage.vue') }],
  nav: [
    {
      id: 'import',
      order: 90,
      label: { ru: 'Импорт', en: 'Import' },
      icon: Upload,
      to: '/m/import/',
    },
  ],
  commands: [
    {
      id: 'import:open',
      label: { ru: 'Импорт задач', en: 'Import tasks' },
      icon: Upload,
      // shortcut: вне setup inject даёт undefined — тогда полная загрузка
      run: () => {
        const router = useRouter();
        if (router) void router.push('/m/import/');
        else window.location.assign('/m/import/');
      },
    },
  ],
});
