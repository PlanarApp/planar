import { matchFilter, type Filter, type FilterCtx, type FilterTask } from '@planar/shared';

export type Task = FilterTask;
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface WidgetLike {
  kind: 'number' | 'bars' | 'line' | 'list';
  config: Record<string, unknown>;
}

/** Задачи дашборда (и личного): задачи его пространства. */
export const boardTasks = (spaceId: string, tasks: Task[]): Task[] =>
  tasks.filter((t) => t.spaceId === spaceId);

/** Значения groupBy у задачи; несколько исполнителей/меток/значений — по столбцу на каждое; пусто — ''. */
export function groupKeys(t: Task, groupBy: string): string[] {
  let v: unknown;
  if (groupBy === 'status') v = t.statusId;
  else if (groupBy === 'priority') v = String(t.priority);
  else if (groupBy === 'assignee') v = t.assigneeIds;
  else if (groupBy === 'label') v = t.labelIds;
  else if (groupBy === 'project') v = t.projectId;
  else v = t.fields?.[groupBy.slice(6)];
  const a = (Array.isArray(v) ? v : [v]).filter((x) => x != null && x !== '').map(String);
  return a.length ? [...new Set(a)] : [''];
}

export function countBy(tasks: Task[], groupBy: string): { key: string; n: number }[] {
  const m = new Map<string, number>();
  for (const t of tasks) for (const k of groupKeys(t, groupBy)) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m]
    .map(([key, n]) => ({ key, n }))
    .sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1));
}

/** Начало недели (локально, YYYY-MM-DD); weekStart: 0 — вс, 1 — пн. */
export function weekOf(d: Date, weekStart: 0 | 1 = 1): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() - weekStart + 7) % 7));
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/** Число задач по неделям createdAt/completedAt за последние `weeks` недель (последняя — текущая). */
export function weekSeries(
  tasks: Task[],
  series: 'created' | 'completed',
  weeks: number,
  now: Date,
  weekStart: 0 | 1 = 1,
): { start: string; n: number }[] {
  const out: { start: string; n: number }[] = [];
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  first.setDate(first.getDate() - 7 * (weeks - 1));
  for (let i = 0; i < weeks; i++) {
    const d = new Date(first);
    d.setDate(d.getDate() + 7 * i);
    out.push({ start: weekOf(d, weekStart), n: 0 });
  }
  const idx = new Map(out.map((p, i) => [p.start, i]));
  for (const t of tasks) {
    const at = series === 'created' ? t.createdAt : t.completedAt;
    const i = at ? idx.get(weekOf(new Date(at), weekStart)) : undefined;
    if (i !== undefined) out[i].n++;
  }
  return out;
}

const nullsLast = (a: string | null, b: string | null) =>
  a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1;
export function sortList(tasks: Task[], sort: string, limit: number): Task[] {
  const by: Record<string, (a: Task, b: Task) => number> = {
    updatedAt: (a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0),
    dueDate: (a, b) => nullsLast(a.dueDate, b.dueDate),
    // 1 — срочный … 4 — низкий, 0 — без приоритета (в конец)
    priority: (a, b) =>
      nullsLast(a.priority ? String(a.priority) : null, b.priority ? String(b.priority) : null),
  };
  return [...tasks].sort(by[sort] ?? by.updatedAt).slice(0, limit);
}

export type Computed =
  | { kind: 'number'; value: number }
  | { kind: 'bars'; bars: { key: string; n: number }[] }
  | { kind: 'line'; points: { start: string; n: number }[] }
  | { kind: 'list'; tasks: Task[] };

/** Значение виджета: filter (matchFilter, F-filter v2), затем подсчёт по kind. */
export function compute(
  w: WidgetLike,
  tasks: Task[],
  ctx: FilterCtx,
  now = new Date(),
  weekStart: 0 | 1 = 1,
): Computed {
  const c = w.config as {
    filter?: Filter;
    groupBy?: string;
    series?: 'created' | 'completed';
    weeks?: number;
    sort?: string;
    limit?: number;
  };
  const rows = tasks.filter((t) => matchFilter(t, c.filter, ctx));
  if (w.kind === 'number') return { kind: 'number', value: rows.length };
  if (w.kind === 'bars') return { kind: 'bars', bars: countBy(rows, c.groupBy ?? 'status') };
  if (w.kind === 'line')
    return {
      kind: 'line',
      points: weekSeries(rows, c.series ?? 'created', c.weeks ?? 12, now, weekStart),
    };
  return { kind: 'list', tasks: sortList(rows, c.sort ?? 'updatedAt', c.limit ?? 10) };
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Сдвиг на (dx, dy) клеток внутри сетки 12 колонок. */
export const moveBox = (b: Box, dx: number, dy: number): Box => ({
  ...b,
  x: clamp(b.x + dx, 0, 12 - b.w),
  y: Math.max(0, b.y + dy),
});
/** Изменение размера на (dw, dh) клеток: w ≤ 12 − x, h 1–12. */
export const resizeBox = (b: Box, dw: number, dh: number): Box => ({
  ...b,
  w: clamp(b.w + dw, 1, 12 - b.x),
  h: clamp(b.h + dh, 1, 12),
});
/** Ниже всех виджетов. */
export const nextY = (ws: Box[]): number => ws.reduce((m, w) => Math.max(m, w.y + w.h), 0);

export interface FieldDefLite {
  id: string;
  name: string;
  type: string;
  options: Record<string, unknown>;
}
/** Поля, по которым можно группировать (select/user): groupBy `field:<id>`. */
export const groupableFields = (defs: FieldDefLite[]) =>
  defs.filter((d) => d.type === 'select' || d.type === 'user');
/** id варианта select -> название (подпись столбца). */
export const choiceNames = (defs: FieldDefLite[]): Record<string, string> =>
  Object.fromEntries(
    defs
      .filter((d) => d.type === 'select')
      .flatMap((d) => (d.options.choices as { id: string; label: string }[] | undefined) ?? [])
      .map((c) => [c.id, c.label]),
  );
