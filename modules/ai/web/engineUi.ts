// PLNRAPP-500: pure logic of the engines monitor (the «Автопилот» section): kept apart to be unit-tested.
import type { EngineEventView } from '../shared/index.js';

/** «2 мин 5 с», «12 с», «1 ч 3 мин»; no end — up to `now` (a running pass). */
export function fmtDuration(start: string, end: string | null, now = Date.now()): string {
  const ms = Math.max(0, (end ? new Date(end).getTime() : now) - new Date(start).getTime());
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} с`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} мин${s % 60 ? ` ${s % 60} с` : ''}`;
  return `${Math.floor(m / 60)} ч${m % 60 ? ` ${m % 60} мин` : ''}`;
}

/** «только что», «5 мин назад», «3 ч назад», «2 дн назад»; null — «—». */
export function fmtAgo(at: string | null, now = Date.now()): string {
  if (!at) return '—';
  const m = Math.floor((now - new Date(at).getTime()) / 60_000);
  if (m < 1) return 'только что';
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} ч назад` : `${Math.floor(h / 24)} дн назад`;
}

export const PERIODS = ['1h', '24h', '7d'] as const;
export type Period = (typeof PERIODS)[number];
const PERIOD_MS: Record<Period, number> = {
  '1h': 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
};
/** The start of the period as ISO (the history keeps 7 days). */
export const sinceOf = (p: Period, now = Date.now()) => new Date(now - PERIOD_MS[p]).toISOString();

/** The live log: the new events after the old ones, no duplicates, the last `max` kept. */
export function appendEvents(have: EngineEventView[], more: EngineEventView[], max = 200) {
  const seen = new Set(have.map((e) => e.id));
  return [...have, ...more.filter((e) => !seen.has(e.id))].slice(-max);
}

/** Tailwind classes of a status badge of an engine card. */
export const statusClass = (s: string) =>
  s === 'running'
    ? 'bg-accent/15 text-accent'
    : s === 'error' || s === 'stalled' || s === 'failed'
      ? 'bg-danger/15 text-danger'
      : s === 'aborted'
        ? 'bg-warning/15 text-warning'
        : 'bg-fg-muted/15 text-fg-muted';
