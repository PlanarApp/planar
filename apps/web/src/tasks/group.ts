import type { Row } from '@planar/shared';
import { i18n } from '../i18n';
import type { TaskView } from './queries';

export type GroupBy = 'none' | 'status' | 'assignee' | 'priority' | 'label';
export interface TaskGroup {
  key: string;
  label: string;
  color?: string;
  tasks: TaskView[];
}
export interface GroupCtx {
  statuses: Row<'statuses'>[];
  members: Row<'users'>[];
  labels: Row<'labels'>[];
  /** summary of several spaces: the status group key (name) instead of id */
  statusKey?: (statusId: string) => string;
}

const NONE = 'none';
const t = (k: string) => i18n.global.t(k);

/** A group per `order` element; a task falls into the group of each of its keys (`keys`). */
function bucket(
  tasks: TaskView[],
  order: { key: string; label: string; color?: string }[],
  keys: (t: TaskView) => string[],
  none?: string,
): TaskGroup[] {
  const groups = order.map((o) => ({ ...o, tasks: [] as TaskView[] }));
  const idx = new Map(groups.map((g, i) => [g.key, i]));
  const noneGroup: TaskGroup = { key: NONE, label: none ?? '', tasks: [] };
  for (const task of tasks) {
    const ks = keys(task);
    if (!ks.length) noneGroup.tasks.push(task);
    // shortcut: a status not in the dictionary is skipped; if needed — an "unknown" group
    for (const k of ks) groups[idx.get(k) ?? -1]?.tasks.push(task);
  }
  return none === undefined ? groups : [...groups, noneGroup];
}

export function groupTasks(tasks: TaskView[], by: GroupBy, ctx: GroupCtx): TaskGroup[] {
  if (by === 'none') return [{ key: 'all', label: t('views.group.all'), tasks }];
  if (by === 'status') {
    const st = ctx.statuses
      .slice()
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
    const k = ctx.statusKey ?? ((id: string) => id);
    const order = new Map(
      st.map((s) => [k(s.id), { key: k(s.id), label: s.name, color: s.color }]),
    );
    return bucket(tasks, [...order.values()], (x) => [k(x.statusId)]);
  }
  if (by === 'priority')
    return bucket(
      tasks,
      [1, 2, 3, 4, 0].map((p) => ({ key: String(p), label: t(`tasks.priority.${p}`) })),
      (x) => [String(x.priority)],
    ).filter((g) => g.tasks.length);
  const assignee = by === 'assignee';
  const known = assignee
    ? ctx.members.map((u) => ({ key: u.id, label: u.name }))
    : ctx.labels.map((l) => ({ key: l.id, label: l.name, color: l.color }));
  const keys = (x: TaskView) => (assignee ? x.assigneeIds : x.labelIds);
  // an id not in the dictionary (deactivated user, label not read) — after the known ones
  const seen = new Set(known.map((k) => k.key));
  const extra = [...new Set(tasks.flatMap(keys))]
    .filter((k) => !seen.has(k))
    .map((key) => ({ key, label: '?' }));
  return bucket(
    tasks,
    [...known, ...extra],
    keys,
    t(assignee ? 'tasks.noAssignee' : 'tasks.noLabel'),
  ).filter((g) => g.tasks.length);
}
