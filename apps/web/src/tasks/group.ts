import type { Row } from '@planar/shared';
import { i18n } from '../i18n';
import type { TaskView } from './queries';

export type GroupBy = 'status' | 'assignee' | 'priority' | 'label';
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
}

const NONE = 'none';
const t = (k: string) => i18n.global.t(k);

/** Группа на каждый элемент `order`; задача попадает в группу каждого из своих ключей (`keys`). */
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
    // shortcut: статус вне справочника пропускается, при необходимости — группа «неизвестно»
    for (const k of ks) groups[idx.get(k) ?? -1]?.tasks.push(task);
  }
  return none === undefined ? groups : [...groups, noneGroup];
}

export function groupTasks(tasks: TaskView[], by: GroupBy, ctx: GroupCtx): TaskGroup[] {
  if (by === 'status') {
    const st = ctx.statuses
      .slice()
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
    return bucket(
      tasks,
      st.map((s) => ({ key: s.id, label: s.name, color: s.color })),
      (x) => [x.statusId],
    );
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
  // id вне справочника (деактивированный пользователь, метка не прочитана) — после известных
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
