/** 'YYYY-MM-DD' → "8 Mar" (with year if not the current one); parsed as a local date, not UTC. */
export function formatDue(d: string, locale: string, now: Date = new Date()): string {
  const [y, m, day] = d.split('-').map(Number);
  if (!y || !m || !day) return d;
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(y !== now.getFullYear() && { year: 'numeric' }),
  })
    .format(new Date(y, m - 1, day))
    .replace(/\s?г\.$/, '');
}
