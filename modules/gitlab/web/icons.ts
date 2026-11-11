import { defineComponent, h, type VNode } from 'vue';

// icons without lucide (the module doesn't depend on it)
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

/** branching (merge request) — the tab icon */
export const Branch = icon(
  () => h('circle', { cx: 6, cy: 5, r: 2 }),
  () => h('circle', { cx: 6, cy: 19, r: 2 }),
  () => h('circle', { cx: 18, cy: 12, r: 2 }),
  () => h('path', { d: 'M6 7v10M8 12h8' }),
);
/** a merge request */
export const MergeRequest = icon(
  () => h('circle', { cx: 6, cy: 6, r: 3 }),
  () => h('circle', { cx: 18, cy: 18, r: 3 }),
  () => h('path', { d: 'M6 9v12M13 6h3a2 2 0 0 1 2 2v7' }),
);
/** a git branch */
export const GitBranch = icon(
  () => h('circle', { cx: 18, cy: 6, r: 3 }),
  () => h('circle', { cx: 6, cy: 18, r: 3 }),
  () => h('path', { d: 'M6 3v12M18 9a9 9 0 0 1-9 9' }),
);
/** refresh (poll now) */
export const Refresh = icon(
  () => h('path', { d: 'M3 12a9 9 0 0 1 15.74-6.26L21 8M21 3v5h-5' }),
  () => h('path', { d: 'M21 12a9 9 0 0 1-15.74 6.26L3 16M8 16H3v5' }),
);
