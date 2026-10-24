export interface WTask {
  id: string;
  statusId: string;
  dueDate: string | null;
  startDate: string | null;
}
export interface Cell {
  hours: number;
  taskIds: string[];
}
export type Mode = 'estimates' | 'count';
export const DEFAULT_CAPACITY = 40;

const DAY = 86400000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Первый день недели (YYYY-MM-DD), содержащей дату; weekStart: 0 — вс, 1 — пн. */
export function weekOf(date: string, weekStart: 0 | 1): string {
  const t = ms(date);
  return iso(t - ((new Date(t).getUTCDay() - weekStart + 7) % 7) * DAY);
}

/** `n` недель подряд, начиная с недели даты `from`. */
export const weekList = (from: string, weekStart: 0 | 1, n = 8): string[] =>
  Array.from({ length: n }, (_, i) => iso(ms(weekOf(from, weekStart)) + i * 7 * DAY));

/**
 * userId → неделя → ячейка. Учитываются задачи с исполнителями, не done/cancelled, с dueDate.
 * estimates (taskId → минуты) задан — режим «оценки», иначе «число задач».
 */
export function compute(a: {
  tasks: WTask[];
  assignees: { taskId: string; userId: string }[];
  doneStatuses: Set<string>;
  estimates?: Map<string, number>;
  weekStart: 0 | 1;
}): Map<string, Map<string, Cell>> {
  const who = new Map<string, string[]>();
  for (const x of a.assignees) who.set(x.taskId, [...(who.get(x.taskId) ?? []), x.userId]);
  const out = new Map<string, Map<string, Cell>>();
  for (const t of a.tasks) {
    const users = who.get(t.id);
    if (!users?.length || !t.dueDate || a.doneStatuses.has(t.statusId)) continue;
    // недели -> доля часов задачи
    const share = new Map<string, number>();
    const est = a.estimates ? (a.estimates.get(t.id) ?? 0) / 60 : 0;
    if (t.startDate && t.startDate <= t.dueDate) {
      const days = (ms(t.dueDate) - ms(t.startDate)) / DAY + 1;
      for (let d = ms(t.startDate); d <= ms(t.dueDate); d += DAY) {
        const w = weekOf(iso(d), a.weekStart);
        share.set(w, (share.get(w) ?? 0) + est / days);
      }
    } else share.set(weekOf(t.dueDate, a.weekStart), est);
    for (const u of users)
      for (const [w, h] of share) {
        const row = out.get(u) ?? new Map<string, Cell>();
        const c = row.get(w) ?? { hours: 0, taskIds: [] };
        c.hours += h / users.length;
        c.taskIds.push(t.id);
        row.set(w, c);
        out.set(u, row);
      }
  }
  return out;
}

export const overloaded = (c: Cell | undefined, capacity: number) => !!c && c.hours > capacity;
