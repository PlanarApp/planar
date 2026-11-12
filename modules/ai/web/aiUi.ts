// Pure logic of the monitoring UI (task tab, «AI tasks»): kept apart from the components to be unit-tested.
import { MAX_RESTARTS, type AiRunState, type AiRunView } from '../shared/index.js';

/** A live run (the queue works on it or it waits for a human): polled and stoppable. */
export const isLive = (s: AiRunState) => s === 'running' || s === 'waiting_human';
export const canStop = isLive;
/** The server also checks the switch and the chain length (409); here — only what is certain from the row. */
export const canRestart = (r: Pick<AiRunView, 'state'>) => !isLive(r.state);

/** Length of the restart chain that ends at `r` (restartOf links), over the loaded runs. */
export function restartDepth(runs: Pick<AiRunView, 'id' | 'restartOf'>[], r: AiRunView): number {
  const by = new Map(runs.map((x) => [x.id, x]));
  let n = 0;
  for (let c = r.restartOf; c && n <= MAX_RESTARTS; c = by.get(c)?.restartOf ?? null) n++;
  return n;
}

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
