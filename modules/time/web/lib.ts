import type { TimeEntry } from '../shared/index.js';

export interface TaskNode {
  id: string;
  parentId: string | null;
}

/** Задача и все её потомки (рекурсивно, без зацикливания). */
export function subtreeIds(tasks: TaskNode[], rootId: string): Set<string> {
  const kids = new Map<string, string[]>();
  for (const t of tasks)
    if (t.parentId) kids.set(t.parentId, [...(kids.get(t.parentId) ?? []), t.id]);
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length)
    for (const c of kids.get(stack.pop()!) ?? [])
      if (!out.has(c)) {
        out.add(c);
        stack.push(c);
      }
  return out;
}

/** Секунды записи: готовая длительность или «сейчас − начало» у идущей. */
export const entrySec = (e: TimeEntry, nowMs: number): number =>
  e.endedAt
    ? (e.durationSec ?? 0)
    : Math.max(0, Math.floor((nowMs - Date.parse(e.startedAt)) / 1000));

/** Сумма своих записей по набору задач. */
export const sumSec = (entries: TimeEntry[], taskIds: Set<string>, userId: string, nowMs: number) =>
  entries.reduce(
    (s, e) => (e.userId === userId && taskIds.has(e.taskId) ? s + entrySec(e, nowMs) : s),
    0,
  );

/** «1:05:09» / «5:09» для таймера. */
export function clock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = String(Math.floor((sec % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${m}:${s}` : `${m}:${s}`;
}

/** «1:30» (часы:минуты); 0 → пусто. */
export const hm = (sec: number): string =>
  sec <= 0
    ? ''
    : `${Math.floor(sec / 3600)}:${String(Math.round((sec % 3600) / 60)).padStart(2, '0')}`;

/** Ввод ячейки: «1:30» или «1.5» / «1,5» (часы). Пусто → 0, мусор → null. */
export function parseHm(s: string): number | null {
  const v = s.trim().replace(',', '.');
  if (!v) return 0;
  let m = /^(\d+):([0-5]?\d)$/.exec(v);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60;
  m = /^(\d+(?:\.\d+)?)$/.exec(v);
  return m ? Math.round(Number(m[1]) * 3600) : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Локальная дата YYYY-MM-DD. */
export const dayKey = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Семь локальных дней недели, содержащей `anchor`; weekStart: 0 — вс, 1 — пн. */
export function weekDays(anchor: Date, weekStart: 0 | 1): Date[] {
  const shift = (anchor.getDay() - weekStart + 7) % 7;
  return Array.from(
    { length: 7 },
    (_, i) => new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - shift + i, 12),
  );
}

export type TimeOp = {
  name: 'time.log' | 'time.update' | 'time.delete';
  args: Record<string, unknown>;
};

/**
 * Правка ячейки (задача × день): новая сумма дня → мутации.
 * Больше — разница добавляется time.log (кусками ≤ 24 ч); меньше — снимается с ручных записей
 * дня, с последней: целиком (delete) или укорочением (update); 0 — удаляются все завершённые
 * записи дня. Если ручных записей не хватает, снимается сколько есть.
 */
export function planCell(
  cell: TimeEntry[],
  targetSec: number,
  dayStartIso: string,
  newId: () => string,
  taskId: string,
): TimeOp[] {
  const done = cell.filter((e) => e.endedAt);
  const cur = done.reduce((s, e) => s + (e.durationSec ?? 0), 0);
  const ops: TimeOp[] = [];
  if (targetSec === 0) return done.map((e) => ({ name: 'time.delete', args: { id: e.id } }));
  let diff = targetSec - cur;
  if (diff > 0) {
    for (let at = Date.parse(dayStartIso); diff > 0; diff -= 86400, at += 86400_000)
      ops.push({
        name: 'time.log',
        args: {
          id: newId(),
          taskId,
          startedAt: new Date(at).toISOString(),
          durationSec: Math.min(diff, 86400),
        },
      });
    return ops;
  }
  let cut = -diff;
  const manual = done
    .filter((e) => e.source === 'manual')
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const e of manual) {
    if (cut <= 0) break;
    const d = e.durationSec ?? 0;
    if (d <= cut) {
      ops.push({ name: 'time.delete', args: { id: e.id } });
      cut -= d;
    } else {
      ops.push({ name: 'time.update', args: { id: e.id, durationSec: d - cut } });
      cut = 0;
    }
  }
  return ops;
}
