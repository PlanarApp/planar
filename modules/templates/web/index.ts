import { defineComponent, h } from 'vue';
import { defineWebModule } from '@planar/web/modules';
import { taskIdByKey, ui } from './data';

// иконка без lucide: страница с копией
const Copy = defineComponent({
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
        h('rect', { x: 9, y: 9, width: 12, height: 12, rx: 2 }),
        h('path', { d: 'M5 15V5a2 2 0 0 1 2-2h10' }),
      ],
    ),
});

export const web = defineWebModule({
  id: 'templates',
  commands: [
    {
      id: 'newTask',
      label: { ru: 'Задача из шаблона…', en: 'Task from template…' },
      icon: Copy,
      newTaskMenu: true,
      when: (ctx) => !!ctx.projectId,
      run: (ctx) => void (ui.newTask = ctx.projectId ?? null),
    },
    {
      id: 'saveTask',
      label: { ru: 'Сохранить как шаблон', en: 'Save as template' },
      icon: Copy,
      when: (ctx) =>
        ctx.selectedTaskIds.length === 1 ||
        (!ctx.selectedTaskIds.length && !!(ctx.route.query.task || ctx.route.name === 'task')),
      async run(ctx) {
        const key = ctx.selectedTaskIds[0] ?? String(ctx.route.query.task ?? ctx.route.params.key);
        ui.saveTask = (await taskIdByKey(key)) ?? null;
      },
    },
  ],
  settings: [
    {
      id: 'templates',
      level: 'space',
      label: { ru: 'Шаблоны', en: 'Templates' },
      icon: Copy,
      component: () => import('./TemplatesSettings.vue'),
    },
  ],
  topbar: [{ id: 'host', component: () => import('./TemplatesHost.vue') }],
});
