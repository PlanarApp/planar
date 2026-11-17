import { generateNKeysBetween } from 'fractional-indexing';
import { api, ApiError } from '../api/http';
import { i18n } from '../i18n';
import { mutate } from '../sync';
import { setAssignees, setLabels, type GroupBy } from '../tasks';
import { toast } from '../ui/toast';
import { swap } from './board/plan';

/**
 * PLNRAPP-294: group drag-n-drop. A selected task dragged while others are selected takes all the
 * selected tasks along, in the view's order `order`; otherwise only the task itself.
 */
export function dragSet(
  selected: ReadonlySet<string>,
  id: string,
  order: readonly string[],
): string[] {
  if (!selected.has(id) || selected.size < 2) return [id];
  const out = [...new Set(order)].filter((x) => selected.has(x));
  return out.includes(id) ? out : [id];
}

/**
 * The drop anchor: the first task of group `to` from the drop slot on that is not moved
 * (null — the end of the group). `rows` — the view's rows from the slot.
 */
export function dropAnchor(
  rows: readonly ({ kind: 'task'; group: string; task: { id: string } } | { kind: string })[],
  to: string,
  moved: ReadonlySet<string>,
): string | null {
  for (const r of rows) {
    if (r.kind !== 'task' || !('group' in r) || r.group !== to) return null;
    if (!moved.has(r.task.id)) return r.task.id;
  }
  return null;
}

/**
 * Ranks for `n` tasks dropped into `column` (by rank, without the moved tasks) before `beforeId`
 * (null — to the end): in a row between the neighbours. Repeated ranks (old data): the tasks after
 * the drop point with a rank ≤ the upper neighbour get new ranks after the moved ones (`rerank`).
 * The same rule as the server's group move (POST /api/v1/tasks/move).
 */
export function groupRanks(
  column: readonly { id: string; rank: string }[],
  beforeId: string | null,
  n: number,
): { ranks: string[]; rerank: [id: string, rank: string][] } {
  const i = beforeId === null ? -1 : column.findIndex((t) => t.id === beforeId);
  const at = i < 0 ? column.length : i;
  const lo = column[at - 1]?.rank ?? null;
  let j = at;
  if (lo !== null) while (j < column.length && column[j]!.rank <= lo) j++;
  const keys = generateNKeysBetween(lo, column[j]?.rank ?? null, n + j - at);
  return {
    ranks: keys.slice(0, n),
    rerank: column.slice(at, j).map((t, k) => [t.id, keys[n + k]!]),
  };
}

/** the server's limit of one group move */
export const GROUP_MOVE_MAX = 100;

/**
 * Status grouping: the atomic group move of the API — all tasks or none. Nothing changes locally
 * before the answer (the replica gets the result by sync), so on an error the view stays as it
 * was; the user sees the reason. true — moved.
 */
export async function moveGroupApi(
  taskIds: string[],
  statusId: string,
  before: string | null,
): Promise<boolean> {
  const t = i18n.global.t;
  if (taskIds.length > GROUP_MOVE_MAX) {
    toast(t('list.groupMoveTooMany', { n: GROUP_MOVE_MAX }));
    return false;
  }
  try {
    await api('POST', '/api/v1/tasks/move', { taskIds, statusId, before });
    return true;
  } catch (e) {
    const why = e instanceof ApiError && e.status ? e.message : '';
    toast(why ? `${t('list.groupMoveFailed')}: ${why}` : t('list.groupMoveFailed'));
    return false;
  }
}

export interface GroupTask {
  id: string;
  priority: number;
  assigneeIds: string[];
  labelIds: string[];
}

/**
 * Other groupings (none, priority, assignee, label): the API moves only by status, so the group field
 * and the ranks are local mutations, as for one task. `from(id)` — the task's group before the move.
 */
export async function moveGroupLocal(a: {
  tasks: GroupTask[];
  by: Exclude<GroupBy, 'status'>;
  from: (id: string) => string | undefined;
  to: string;
  ranks: string[];
  rerank: [string, string][];
  labelKey?: (id: string) => string;
  /** a summary: label keys are names — back to the ids of the task's project */
  fixLabels?: (task: GroupTask, labels: string[]) => string[];
}): Promise<void> {
  for (const [id, rank] of a.rerank) await mutate('task.update', { id, rank });
  for (const [k, x] of a.tasks.entries()) {
    const from = a.from(x.id);
    const change = from !== undefined && from !== a.to;
    if (change && a.by === 'assignee') await setAssignees(x.id, swap(x.assigneeIds, from, a.to));
    if (change && a.by === 'label') {
      const ls = swap(x.labelIds, from, a.to, a.labelKey);
      await setLabels(x.id, a.fixLabels ? a.fixLabels(x, ls) : ls);
    }
    await mutate('task.update', {
      id: x.id,
      rank: a.ranks[k],
      ...(change && a.by === 'priority' && { priority: Number(a.to) }),
    });
  }
}
