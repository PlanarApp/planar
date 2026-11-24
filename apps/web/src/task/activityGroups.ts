import type { Row } from '@planar/shared';

type Act = Row<'activity'>;

/**
 * PLNRAPP-825: what makes two history entries «the same action» — the author, the kind and,
 * for an edit, the set of the changed fields (two description edits in a row — one entry)
 */
export function actKey(a: Act): string {
  const fields = a.kind === 'updated' ? Object.keys(a.changes as object).sort() : [];
  return [a.actorId, a.kind, ...fields].join('\u0000');
}

/**
 * runs of neighbours with an equal key, in the given order; a null key (a comment) is never merged
 * and breaks a run — only consecutive actions are grouped
 */
export function groupRuns<T>(items: T[], key: (t: T) => string | null): T[][] {
  const out: T[][] = [];
  let last: string | null = null;
  for (const it of items) {
    const k = key(it);
    if (k !== null && k === last) out.at(-1)!.push(it);
    else out.push([it]);
    last = k;
  }
  return out;
}

/**
 * the changes of a run of edits (oldest first): a field with values — from the first old to the last new
 */
export function mergeChanges(acts: Act[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of acts)
    for (const [f, pair] of Object.entries(a.changes as Record<string, unknown>)) {
      const prev = out[f];
      out[f] = Array.isArray(prev) && Array.isArray(pair) ? [prev[0], pair[1]] : (prev ?? pair);
    }
  return out;
}
