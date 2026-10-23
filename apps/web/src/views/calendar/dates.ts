// Календарные даты YYYY-MM-DD без часового пояса: только локальные компоненты, без toISOString/Date.parse.
const pad = (n: number) => String(n).padStart(2, '0');
export const fmt = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s: string): Date => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y!, m! - 1, d);
};
export const addDays = (s: string, n: number): string => {
  const d = parse(s);
  return fmt(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
};
/** Разница в днях b − a (через UTC-компоненты, переход на летнее время не влияет). */
export const diffDays = (a: string, b: string): number => {
  const [x, y] = [a, b].map((s) => {
    const [yy, mm, dd] = s.split('-').map(Number);
    return Date.UTC(yy!, mm! - 1, dd);
  });
  return Math.round((y! - x!) / 864e5);
};
export const addMonths = (s: string, n: number): string => {
  const d = parse(s);
  return fmt(new Date(d.getFullYear(), d.getMonth() + n, 1));
};
const monday = (s: string) => addDays(s, -((parse(s).getDay() + 6) % 7));

export const weekDays = (anchor: string): string[] => {
  const m = monday(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(m, i));
};
export const monthDays = (anchor: string): string[] => {
  const d = parse(anchor);
  const first = fmt(new Date(d.getFullYear(), d.getMonth(), 1));
  const last = fmt(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const start = monday(first);
  return Array.from({ length: Math.ceil((diffDays(start, last) + 1) / 7) * 7 }, (_, i) =>
    addDays(start, i),
  );
};

interface Dated {
  id: string;
  startDate: string | null;
  dueDate: string | null;
}
/** Диапазон показа: обе даты — start..due (перепутанные меняются местами), одна — день, нет — null. */
export function range(t: Dated): [string, string] | null {
  const a = t.startDate ?? t.dueDate;
  const b = t.dueDate ?? t.startDate;
  if (!a || !b) return null;
  return a <= b ? [a, b] : [b, a];
}
/** Задачи по дням из `days`; порядок задач сохраняется. */
export function layout<T extends Dated>(tasks: T[], days: string[]): Map<string, T[]> {
  const res = new Map(days.map((d) => [d, [] as T[]]));
  for (const t of tasks) {
    const r = range(t);
    if (!r) continue;
    for (const d of days) if (d >= r[0] && d <= r[1]) res.get(d)!.push(t);
  }
  return res;
}
/** Патч дат при переносе: `from` — день, с которого тянут (null — из «Без даты»). */
export function shift(
  t: Dated,
  from: string | null,
  to: string,
): { startDate?: string; dueDate?: string } {
  if (!from || !range(t)) return { dueDate: to };
  const n = diffDays(from, to);
  return {
    ...(t.startDate && { startDate: addDays(t.startDate, n) }),
    ...(t.dueDate && { dueDate: addDays(t.dueDate, n) }),
  };
}
