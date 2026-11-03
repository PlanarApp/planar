import { generateNKeysBetween } from 'fractional-indexing';
import { i18n } from '../../i18n';
import { mutate } from '../../sync';
import {
  groupTasks,
  labelColumns,
  moveTask,
  setAssignees,
  setLabels,
  updateTask,
} from '../../tasks';
import type { GroupBy, TaskGroup } from '../../tasks';

export interface MovePlan {
  id: string;
  statusId?: string;
  after: string | null;
  before: string | null;
  assign?: string[];
  labels?: string[];
  priority?: number;
  /** neighbours with the same rank: new ranks go to tasks after the insertion point (otherwise nothing fits between them) */
  rerank?: [id: string, rank: string][];
}

const NONE = 'none';
const swap = (cur: string[], from: string, to: string, key: (id: string) => string = (v) => v) => {
  const rest = cur.filter((v) => key(v) !== from);
  return to === NONE ? rest : [...new Set([...rest, to])];
};

/**
 * Columns: inside — by rank (the view's sort does not apply on the board, order is manual).
 * groupTasks drops empty groups, but on the board one can also drag into an empty column — we add it.
 */
export function boardColumns(
  tasks: Parameters<typeof groupTasks>[0],
  by: GroupBy,
  ctx: Parameters<typeof groupTasks>[2],
): TaskGroup[] {
  const got = new Map(groupTasks(tasks, by, ctx).map((g) => [g.key, g]));
  const t = (k: string) => i18n.global.t(k);
  const all: Omit<TaskGroup, 'tasks'>[] =
    by === 'priority'
      ? [1, 2, 3, 4, 0].map((p) => ({ key: String(p), label: t(`tasks.priority.${p}`) }))
      : by === 'assignee'
        ? [
            ...ctx.members.map((u) => ({ key: u.id, label: u.name })),
            { key: NONE, label: t('tasks.noAssignee') },
          ]
        : by === 'label'
          ? [...labelColumns(ctx.labels, ctx.labelKey), { key: NONE, label: t('tasks.noLabel') }]
          : [];
  const known = new Set(all.map((c) => c.key));
  return [
    ...all.map((c) => got.get(c.key) ?? { ...c, tasks: [] }),
    ...[...got.values()].filter((g) => by === 'status' || !known.has(g.key)),
  ].map((g) => ({
    ...g,
    tasks: g.tasks.slice().sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0)),
  }));
}

/**
 * Moving task `id` from column `from` to column `to` before `beforeId` (null — to the end).
 * Neighbours are counted in the column without the task itself, so the rank is strictly between them.
 */
export function planMove(
  columns: TaskGroup[],
  by: GroupBy,
  id: string,
  from: string,
  to: string,
  beforeId: string | null,
  labelKey?: (id: string) => string, // summary: label columns are keyed by name
): MovePlan | null {
  const task = columns.find((c) => c.key === from)?.tasks.find((t) => t.id === id);
  const target = columns.find((c) => c.key === to)?.tasks.filter((t) => t.id !== id);
  if (!task || !target) return null;
  const at = beforeId === null ? -1 : target.findIndex((t) => t.id === beforeId);
  const i = at < 0 ? target.length : at;
  // dropped back in the same place — no mutation
  if (from === to) {
    const col = columns.find((c) => c.key === from)!.tasks;
    if (beforeId === id || i === col.findIndex((t) => t.id === id)) return null;
  }
  const plan: MovePlan = {
    id,
    after: target[i - 1]?.rank ?? null,
    before: target[i]?.rank ?? null,
  };
  // ranks repeat (project summary, old data): tasks with the neighbour-above rank that follow the insertion point,
  // get a rank before the next larger one; the task goes before the first of them
  const lo = plan.after;
  if (lo !== null && plan.before !== null && plan.before <= lo) {
    let j = i;
    while (j < target.length && target[j]!.rank <= lo) j++;
    const keys = generateNKeysBetween(lo, target[j]?.rank ?? null, j - i + 1);
    plan.rerank = target.slice(i, j).map((t, k) => [t.id, keys[k + 1]!]);
    plan.before = keys[1]!;
  }
  if (from !== to) {
    if (by === 'status') plan.statusId = to;
    else if (by === 'priority') plan.priority = Number(to);
    else if (by === 'assignee') plan.assign = swap(task.assigneeIds, from, to);
    else plan.labels = swap(task.labelIds, from, to, labelKey);
  }
  return plan;
}

export async function applyMove(p: MovePlan): Promise<void> {
  for (const [id, rank] of p.rerank ?? []) await mutate('task.update', { id, rank });
  if (p.priority !== undefined) await updateTask(p.id, { priority: p.priority });
  if (p.assign) await setAssignees(p.id, p.assign);
  if (p.labels) await setLabels(p.id, p.labels);
  await moveTask(p.id, { statusId: p.statusId, after: p.after, before: p.before });
}
