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

/** Kind of a due date relative to local today (PLNRAPP-872): before — overdue, today, later — future. */
export type DueKind = 'overdue' | 'today' | 'future';

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function dueKind(d: string, now: Date = new Date()): DueKind {
  const today = ymd(now);
  return d < today ? 'overdue' : d === today ? 'today' : 'future';
}

/**
 * The text color of a due date — the same theme tokens everywhere (List, My day, task card, mobile cards, dates):
 * past — red, today — green, future — the text color (tokens.css, --color-due-*).
 */
export const DUE_TONE: Record<DueKind, string> = {
  overdue: 'text-due-overdue',
  today: 'text-due-today',
  future: 'text-due-future',
};

/** 'YYYY-MM-DD' | null → the due date's color class ('' without a date). */
export function dueTone(d: string | null | undefined, now: Date = new Date()): string {
  return d ? DUE_TONE[dueKind(d, now)] : '';
}
