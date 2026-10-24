import { h } from 'vue';

// иконки без lucide (у модуля нет этой зависимости)
const icon =
  (...d: string[]) =>
  () =>
    h(
      'svg',
      {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 2,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        width: 16,
        height: 16,
      },
      d.map((x) => h('path', { d: x })),
    );

export const ChevronLeft = icon('m15 18-6-6 6-6');
export const ChevronRight = icon('m9 18 6-6-6-6');
export const MoreHorizontal = icon('M5 12h.01', 'M12 12h.01', 'M19 12h.01');
