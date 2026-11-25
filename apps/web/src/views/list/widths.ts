import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import type { Row } from '@planar/shared';
import type { TaskView } from '../../tasks';
import { formatDue } from './due';
import type { ListColumn } from './columns';

/** Text width in px with the page font (canvas); without canvas (tests) — by character count. */
let ctx: CanvasRenderingContext2D | null | undefined;
// a column measures every row: the same dates/projects/labels repeat — measured once; a loaded web font re-measures
const measured = new Map<string, number>();
globalThis.document?.fonts?.addEventListener('loadingdone', () => measured.clear());
export function textWidth(s: string, px = 14): number {
  if (ctx === undefined)
    try {
      ctx = document.createElement('canvas').getContext('2d');
    } catch {
      ctx = null;
    }
  if (!ctx) return s.length * px * 0.55;
  const k = `${px}|${s}`;
  let w = measured.get(k);
  if (w === undefined) {
    if (measured.size > 5000) measured.clear();
    ctx.font = `${px}px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`;
    measured.set(k, (w = ctx.measureText(s).width));
  }
  return w;
}

const MIN = 64;
const MAX = 360;
const clamp = (n: number) => Math.round(Math.min(MAX, Math.max(MIN, n)));

export interface WidthCtx {
  labels: Map<string, string>;
  projects: Map<string, string>;
  priority: (p: number) => string;
  locale: string;
}

/** Column auto-size by row content (as in ClickUp): widest value + cell padding. */
export function autoWidth(c: ListColumn, tasks: readonly TaskView[], x: WidthCtx): number {
  if (c === 'git') return 72;
  if (c === 'ai' || c === 'aiCost' || c === 'aiTime') return 96;
  let w = 0;
  for (const t of tasks) {
    const v =
      c === 'assignee'
        ? // AvatarStack: up to 3 avatars of 20px with a 4px overlap, then "+N"
          t.assigneeIds.length
          ? 20 + 16 * (Math.min(t.assigneeIds.length, 3) - 1) + (t.assigneeIds.length > 3 ? 16 : 0)
          : 16
        : c === 'dueDate'
          ? t.dueDate
            ? textWidth(formatDue(t.dueDate, x.locale))
            : 16
          : c === 'priority'
            ? t.priority
              ? textWidth(x.priority(t.priority)) + 22
              : 16
            : c === 'labels'
              ? t.labelIds.reduce((s, id) => s + textWidth(x.labels.get(id) ?? '', 12) + 24, 0)
              : textWidth(x.projects.get(t.projectId) ?? '');
    if (v > w) w = v;
  }
  return clamp(w + 16);
}

/** List column widths: auto-size by content (the list has no header row to drag a width in). */
export function useColumnWidths(
  columns: MaybeRefOrGetter<readonly ListColumn[]>,
  tasks: MaybeRefOrGetter<readonly TaskView[] | undefined>,
  x: MaybeRefOrGetter<WidthCtx>,
) {
  const widths = computed(() => {
    const ts = toValue(tasks) ?? [];
    const c = toValue(x);
    return Object.fromEntries(
      toValue(columns).map((col) => [col, autoWidth(col, ts, c)]),
    ) as Record<ListColumn, number>;
  });
  return { widths };
}

export type { Row };
