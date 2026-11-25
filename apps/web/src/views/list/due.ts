import { localToday } from '../filter';

// an Intl.DateTimeFormat costs ~0.1 ms to build: one per locale and year option (thousands of rows — PLNRAPP-247)
const formats = new Map<string, Intl.DateTimeFormat>();
const dueFormat = (locale: string, year: boolean) => {
  const k = `${locale}|${year}`;
  let f = formats.get(k);
  if (!f)
    formats.set(
      k,
      (f = new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        ...(year && { year: 'numeric' }),
      })),
    );
  return f;
};

/** 'YYYY-MM-DD' → "8 Mar" (with year if not the current one); parsed as a local date, not UTC. */
export function formatDue(d: string, locale: string, now: Date = new Date()): string {
  const [y, m, day] = d.split('-').map(Number);
  if (!y || !m || !day) return d;
  return dueFormat(locale, y !== now.getFullYear())
    .format(new Date(y, m - 1, day))
    .replace(/\s+г\.$/, ''); // the year suffix only: "авг." keeps its "г."
}

/** a date's color: past — danger, today — success, future — the text color */
export const dateTone = (d: string, today = localToday()) =>
  d < today ? 'text-danger' : d === today ? 'text-success' : 'text-fg';
