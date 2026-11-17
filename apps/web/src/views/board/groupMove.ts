import { generateNKeysBetween } from 'fractional-indexing';
import type { TaskGroup } from '../../tasks';

/**
 * PLNRAPP-293: group drag-n-drop on the board. A drag of a selected card carries every selected card
 * of the board; the drop goes to POST /api/v1/tasks/move, the board shows the result at once (overlay).
 */

type Ranked = { id: string; rank: string };
type Placed = Ranked & { statusId: string };
/** a local change of a task until the replica has it: status (for the moved ones) and rank */
export type MovePatch = { statusId?: string; rank: string };

const byRank = (a: Ranked, b: Ranked) =>
  a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Tasks carried by a drag of `id`: a selected card — all selected cards of the board in the board order
 * (column by column, top-down); an unselected one — only it.
 */
export function dragGroup(
  columns: readonly TaskGroup[],
  id: string,
  selected: ReadonlySet<string>,
): string[] {
  if (!selected.has(id)) return [id];
  const ids = columns.flatMap((c) => c.tasks.map((t) => t.id)).filter((x) => selected.has(x));
  return ids.includes(id) ? ids : [id];
}

/** Ranks for `n` tasks put in a row at index `at` of `column` (sorted, without them); as dropRanks of the API. */
export function dropRanks(
  column: readonly Ranked[],
  at: number,
  n: number,
): { ranks: string[]; rerank: [id: string, rank: string][] } {
  const lo = column[at - 1]?.rank ?? null;
  let j = at;
  if (lo !== null) while (j < column.length && column[j]!.rank <= lo) j++;
  const keys = generateNKeysBetween(lo, column[j]?.rank ?? null, n + j - at);
  return {
    ranks: keys.slice(0, n),
    rerank: column.slice(at, j).map((t, k) => [t.id, keys[n + k]!]),
  };
}

export interface GroupMovePlan {
  ids: string[];
  statusId: string;
  /** the `before` of the API request: a task of the target status; null — to the end */
  before: string | null;
  /** the expected result: new status and rank of the moved tasks, new ranks of repeated-rank neighbours */
  patch: Map<string, MovePatch>;
}

/**
 * Group `ids` (in this order) dropped into status `statusId` before `beforeId` (null — to the end).
 * The column is all tasks of the status, not only the shown ones — as the API counts it. The anchor is one
 * of the moved tasks — the group goes before the next one that stays. null — nothing changes.
 */
export function planGroupMove(
  tasks: readonly Placed[],
  ids: readonly string[],
  statusId: string,
  beforeId: string | null,
): GroupMovePlan | null {
  if (!ids.length) return null;
  const moving = new Set(ids);
  const column = tasks.filter((t) => t.statusId === statusId).sort(byRank);
  const rest = column.filter((t) => !moving.has(t.id));
  let i = beforeId === null ? -1 : column.findIndex((t) => t.id === beforeId);
  if (i < 0) i = column.length;
  while (i < column.length && moving.has(column[i]!.id)) i++;
  const at = column.slice(0, i).filter((t) => !moving.has(t.id)).length;
  const after = [...rest.slice(0, at).map((t) => t.id), ...ids, ...rest.slice(at).map((t) => t.id)];
  if (
    after.length === column.length &&
    after.every((id, k) => column[k]!.id === id) // all already in the status, in a row, in this order
  )
    return null;
  const { ranks, rerank } = dropRanks(rest, at, ids.length);
  return {
    ids: [...ids],
    statusId,
    before: rest[at]?.id ?? null,
    patch: new Map<string, MovePatch>([
      ...ids.map((id, k) => [id, { statusId, rank: ranks[k]! }] as const),
      ...rerank.map(([id, rank]) => [id, { rank }] as const),
    ]),
  };
}

/** Tasks with the local changes over the replica. */
export function withPatch<T extends Placed>(
  tasks: readonly T[],
  patch: ReadonlyMap<string, MovePatch>,
): T[] {
  if (!patch.size) return tasks as T[];
  return tasks.map((t) => {
    const p = patch.get(t.id);
    return p ? { ...t, ...p } : t;
  });
}

/** Changes the replica already has (the server sync came) — they are dropped from the overlay. */
export function settled(tasks: readonly Placed[], patch: ReadonlyMap<string, MovePatch>): string[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return [...patch].flatMap(([id, p]) => {
    const t = byId.get(id);
    return !t || (t.rank === p.rank && (p.statusId === undefined || t.statusId === p.statusId))
      ? [id]
      : [];
  });
}
