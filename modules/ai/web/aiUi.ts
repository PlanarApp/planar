// Pure logic of the monitoring UI (task tab, «AI tasks»): kept apart from the components to be unit-tested.
import { type AiRunEvent, type AiRunState, type AiRunView } from '../shared/index.js';

/** A live run (the queue works on it or it waits for a human): polled and stoppable. */
export const isLive = (s: AiRunState) => s === 'running' || s === 'waiting_human';
export const canStop = isLive;
/** The server also checks the switch and the chain length (409); here — only what is certain from the row. */
export const canRestart = (r: Pick<AiRunView, 'state'>) => !isLive(r.state);

/** Share of the limit used, 0..100; no limit (null) or a zero limit — null (nothing to show). */
export const usagePct = (used: number, limit: number | null): number | null =>
  limit ? Math.min(100, Math.round((used / limit) * 100)) : null;

export const fmtCost = (c: number | null) => (c == null ? '—' : `$${c.toFixed(4)}`);

/** Empty or number from an input → limit value; negative / NaN — undefined (invalid). */
export function parseLimit(v: string): number | null | undefined {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Runs of a page (newest first) + the next page, without duplicates by id. */
export function mergeRuns<T extends { id: string }>(have: T[], more: T[]): T[] {
  const seen = new Set(have.map((r) => r.id));
  return [...have, ...more.filter((r) => !seen.has(r.id))];
}

/** Events of the agent's log kept on the client: the server keeps the tail of the same size. */
export const MAX_LOG_EVENTS = 500;

/** Agent log events (by id ascending) + the next batch after the cursor: no duplicates, only the tail. */
export function mergeEvents(have: AiRunEvent[], more: AiRunEvent[]): AiRunEvent[] {
  const last = have.at(-1)?.id ?? 0;
  return [...have, ...more.filter((e) => e.id > last)].slice(-MAX_LOG_EVENTS);
}

/** A long event text folds: the first lines are visible, the rest — on demand. null — short, shown whole. */
export function foldOf(text: string, lines = 3, chars = 300): string | null {
  const head = text.split('\n').slice(0, lines).join('\n');
  const cut = head.length > chars ? head.slice(0, chars) : head;
  return cut.length < text.length ? `${cut}…` : null;
}
