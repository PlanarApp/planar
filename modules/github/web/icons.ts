import { defineComponent, h, type VNode } from 'vue';

// icon without lucide (the module doesn't depend on it): a pull request
export const GithubIcon = defineComponent({
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
        h('circle', { cx: 6, cy: 6, r: 2 }),
        h('circle', { cx: 6, cy: 18, r: 2 }),
        h('circle', { cx: 18, cy: 18, r: 2 }),
        h('path', { d: 'M6 8v8M18 16V9a3 3 0 0 0-3-3h-4M13 3l-2 3 2 3' }),
      ],
    ),
});

// PLNRAPP-892: the task tab's commit and refresh icons
const icon = (...parts: (() => VNode)[]) =>
  defineComponent({
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
        parts.map((f) => f()),
      ),
  });
/** a commit: a dot on a line */
export const Commit = icon(
  () => h('circle', { cx: 12, cy: 12, r: 3 }),
  () => h('path', { d: 'M3 12h6M15 12h6' }),
);
export const Refresh = icon(
  () => h('path', { d: 'M3 12a9 9 0 0 1 15.74-6.26L21 8M21 3v5h-5' }),
  () => h('path', { d: 'M21 12a9 9 0 0 1-15.74 6.26L3 16M8 16H3v5' }),
);
