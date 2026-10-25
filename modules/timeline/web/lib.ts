// Чистая логика вида «Таймлайн» (P3-timeline v1): даты — YYYY-MM-DD, дни считаются числом от эпохи (UTC).
export type Scale = 'day' | 'week' | 'month';
export interface Dated {
  id: string;
  startDate: string | null;
  dueDate: string | null;
}
export interface Bar {
  s: number;
  e: number;
}
export interface Link {
  id: string;
  taskId: string;
  targetId: string;
  kind: string;
}

export const ROW_H = 32;
export const PX: Record<Scale, number> = { day: 32, week: 12, month: 4 };

const DAY_MS = 86_400_000;
export const toDay = (d: string): number => {
  const [y, m, dd] = d.split('-').map(Number);
  return Math.round(Date.UTC(y!, m! - 1, dd!) / DAY_MS);
};
export const fromDay = (n: number): string => new Date(n * DAY_MS).toISOString().slice(0, 10);

/** Полоса по датам (включительно): обе — [start, due] (start > due — переставлены); одна — 1 день; нет — null. */
export function barOf(t: Dated): Bar | null {
  const a = t.startDate ? toDay(t.startDate) : null;
  const b = t.dueDate ? toDay(t.dueDate) : null;
  if (a === null && b === null) return null;
  if (a === null || b === null) return { s: a ?? b!, e: a ?? b! };
  return { s: Math.min(a, b), e: Math.max(a, b) };
}

export type DateArgs = {
  id: string;
  startDate?: string;
  dueDate?: string;
};

/** Перенос на delta дней: сдвиг обеих дат (какие есть). */
export function moveArgs(t: Dated, delta: number): DateArgs {
  const a: DateArgs = { id: t.id };
  if (t.startDate) a.startDate = fromDay(toDay(t.startDate) + delta);
  if (t.dueDate) a.dueDate = fromDay(toDay(t.dueDate) + delta);
  return a;
}

/** Растягивание края полосы до дня `day`: одна дата превращается в обе; край не переходит за другой. */
export function resizeArgs(t: Dated, edge: 'start' | 'end', day: number): DateArgs {
  const b = barOf(t)!;
  const s = edge === 'start' ? Math.min(day, b.e) : b.s;
  const e = edge === 'end' ? Math.max(day, b.s) : b.e;
  return { id: t.id, startDate: fromDay(s), dueDate: fromDay(e) };
}

/** Перенос из «Без дат»: обе даты = день, длительность 1 день. */
export const dropArgs = (id: string, day: number): DateArgs => ({
  id,
  startDate: fromDay(day),
  dueDate: fromDay(day),
});

/** Нарушение «A блокирует B»: начало B ≤ конец A (обе на шкале). */
export const violates = (a: Bar | null, b: Bar | null): boolean => !!a && !!b && b.s <= a.e;

/** Связи `blocks` с нарушением после применения args к задаче `id`, которых до переноса не было. */
export function newViolations(
  links: Link[],
  bars: (id: string) => Bar | null,
  id: string,
  next: Bar,
): Link[] {
  const after = (x: string) => (x === id ? next : bars(x));
  return links.filter(
    (l) =>
      l.kind === 'blocks' &&
      (l.taskId === id || l.targetId === id) &&
      violates(after(l.taskId), after(l.targetId)) &&
      !violates(bars(l.taskId), bars(l.targetId)),
  );
}

/** Окно видимых строк [from, to) с запасом. */
export function rowWindow(
  scrollTop: number,
  viewH: number,
  total: number,
  overscan = 8,
  rowH = ROW_H,
): [number, number] {
  const from = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const to = Math.min(total, Math.ceil((scrollTop + viewH) / rowH) + overscan);
  return [from, Math.max(from, to)];
}

/** Видимый диапазон дней [from, to] (включительно) по прокрутке; origin — день левого края шкалы. */
export function dayWindow(
  scrollLeft: number,
  viewW: number,
  origin: number,
  scale: Scale,
  overscanDays = 2,
): [number, number] {
  const px = PX[scale];
  return [
    origin + Math.floor(scrollLeft / px) - overscanDays,
    origin + Math.ceil((scrollLeft + viewW) / px) + overscanDays,
  ];
}

/** Метки шкалы в диапазоне: день — каждый день, неделя — первый день недели, месяц — 1-е число. */
export function ticks(
  from: number,
  to: number,
  scale: Scale,
  weekStart: 0 | 1,
): { day: number; label: string }[] {
  const out: { day: number; label: string }[] = [];
  for (let d = from; d <= to; d++) {
    const dt = new Date(d * DAY_MS);
    const dow = dt.getUTCDay();
    const dom = dt.getUTCDate();
    if (scale === 'week' && dow !== weekStart) continue;
    if (scale === 'month' && dom !== 1) continue;
    out.push({
      day: d,
      label: scale === 'month' ? fromDay(d).slice(0, 7) : fromDay(d).slice(scale === 'day' ? 8 : 5),
    });
  }
  return out;
}

/** Границы шкалы: все полосы + сегодня, с запасом по краям. */
export function span(bars: Bar[], today: number, pad = 14): [number, number] {
  let lo = today;
  let hi = today;
  for (const b of bars) {
    if (b.s < lo) lo = b.s;
    if (b.e > hi) hi = b.e;
  }
  return [lo - pad, hi + pad];
}
