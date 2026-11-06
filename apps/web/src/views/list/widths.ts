import { ref, watch, computed, toValue, type MaybeRefOrGetter } from 'vue';
import type { Row } from '@planar/shared';
import type { TaskView } from '../../tasks';
import { formatDue } from './due';
import type { ListColumn } from './columns';

/** Text width in px with the page font (canvas); without canvas (tests) — by character count. */
let ctx: CanvasRenderingContext2D | null | undefined;
export function textWidth(s: string, px = 14): number {
  if (ctx === undefined)
    try {
      ctx = document.createElement('canvas').getContext('2d');
    } catch {
      ctx = null;
    }
  if (!ctx) return s.length * px * 0.55;
  ctx.font = `${px}px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`;
  return ctx.measureText(s).width;
}

const MIN = 64;
const MAX = 360;
const clamp = (n: number) => Math.round(Math.min(MAX, Math.max(MIN, n)));

export interface WidthCtx {
  labels: Map<string, string>;
  projects: Map<string, string>;
  header: (c: ListColumn) => string;
  priority: (p: number) => string;
  locale: string;
}

/** Column auto-size by row content (as in ClickUp): widest value + cell padding. */
export function autoWidth(c: ListColumn, tasks: readonly TaskView[], x: WidthCtx): number {
  const head = textWidth(x.header(c), 12) + 16;
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
  return clamp(Math.max(head, w + 16));
}

/**
 * List column widths: auto-size by content; a width dragged by hand is remembered
 * (localStorage, per view key), a double click on the divider returns auto-size.
 */
export function useColumnWidths(
  key: MaybeRefOrGetter<string>,
  columns: MaybeRefOrGetter<readonly ListColumn[]>,
  tasks: MaybeRefOrGetter<readonly TaskView[] | undefined>,
  x: MaybeRefOrGetter<WidthCtx>,
) {
  const store = () => `planar.list.${toValue(key)}.widths`;
  const manual = ref<Partial<Record<ListColumn, number>>>({});
  watch(
    () => toValue(key),
    () => {
      try {
        manual.value = JSON.parse(localStorage.getItem(store()) ?? '{}');
      } catch {
        manual.value = {};
      }
    },
    { immediate: true },
  );
  const save = () => {
    try {
      localStorage.setItem(store(), JSON.stringify(manual.value));
    } catch {
      /* no storage — until reload */
    }
  };
  const widths = computed(() => {
    const ts = toValue(tasks) ?? [];
    const c = toValue(x);
    return Object.fromEntries(
      toValue(columns).map((col) => [col, manual.value[col] ?? autoWidth(col, ts, c)]),
    ) as Record<ListColumn, number>;
  });
  const set = (col: ListColumn, px: number) => {
    manual.value = { ...manual.value, [col]: clamp(px) };
    save();
  };
  const reset = (col: ListColumn) => {
    const m = { ...manual.value };
    delete m[col];
    manual.value = m;
    save();
  };
  /** dragging the divider in the column header */
  function startResize(col: ListColumn, e: PointerEvent) {
    const x0 = e.clientX;
    const w0 = widths.value[col];
    const move = (ev: PointerEvent) => set(col, w0 + ev.clientX - x0);
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  }
  return { widths, startResize, reset };
}

export type { Row };
