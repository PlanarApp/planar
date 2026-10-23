import { i18n } from '../../i18n';
import { groupTasks, moveTask, setAssignees, setLabels, updateTask } from '../../tasks';
import type { GroupBy, TaskGroup } from '../../tasks';

export interface MovePlan {
  id: string;
  statusId?: string;
  after: string | null;
  before: string | null;
  assign?: string[];
  labels?: string[];
  priority?: number;
}

const NONE = 'none';
const swap = (cur: string[], from: string, to: string) => {
  const rest = cur.filter((v) => v !== from);
  return to === NONE ? rest : [...new Set([...rest, to])];
};

/**
 * Колонки: внутри — по rank (сортировка вида на доске не действует, порядок ручной).
 * groupTasks отбрасывает пустые группы, а на доску можно тащить и в пустую колонку — дополняем.
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
          ? [
              ...ctx.labels.map((l) => ({ key: l.id, label: l.name, color: l.color })),
              { key: NONE, label: t('tasks.noLabel') },
            ]
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
 * Перенос задачи `id` из колонки `from` в колонку `to` перед `beforeId` (null — в конец).
 * Соседи считаются по колонке без самой задачи, поэтому rank строго между ними.
 */
export function planMove(
  columns: TaskGroup[],
  by: GroupBy,
  id: string,
  from: string,
  to: string,
  beforeId: string | null,
): MovePlan | null {
  const task = columns.find((c) => c.key === from)?.tasks.find((t) => t.id === id);
  const target = columns.find((c) => c.key === to)?.tasks.filter((t) => t.id !== id);
  if (!task || !target) return null;
  const at = beforeId === null ? -1 : target.findIndex((t) => t.id === beforeId);
  const i = at < 0 ? target.length : at;
  // бросили на прежнее место — мутации нет
  if (from === to) {
    const col = columns.find((c) => c.key === from)!.tasks;
    if (beforeId === id || i === col.findIndex((t) => t.id === id)) return null;
  }
  const plan: MovePlan = {
    id,
    after: target[i - 1]?.rank ?? null,
    before: target[i]?.rank ?? null,
  };
  if (from !== to) {
    if (by === 'status') plan.statusId = to;
    else if (by === 'priority') plan.priority = Number(to);
    else if (by === 'assignee') plan.assign = swap(task.assigneeIds, from, to);
    else plan.labels = swap(task.labelIds, from, to);
  }
  return plan;
}

export async function applyMove(p: MovePlan): Promise<void> {
  if (p.priority !== undefined) await updateTask(p.id, { priority: p.priority });
  if (p.assign) await setAssignees(p.id, p.assign);
  if (p.labels) await setLabels(p.id, p.labels);
  await moveTask(p.id, { statusId: p.statusId, after: p.after, before: p.before });
}
