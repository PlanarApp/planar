import { defineComponent, h } from 'vue';

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
