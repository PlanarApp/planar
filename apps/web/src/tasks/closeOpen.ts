import { shallowRef } from 'vue';
import type { Row } from '@planar/shared';
import { db, mutate } from '../sync';
import { i18n } from '../i18n';
import { loadDetails } from '../task/details';
import { toast } from '../ui/toast';

/**
 * Closing a task — to any status of the category done/cancelled (PLNRAPP-138, -805) — with open subtasks,
 * open checklist items or open assigned comments: ask what to do with them.
 */

export type ClosePrompt = {
  task: Row<'tasks'>;
  /** the closed status the task goes to: open subtasks follow it */
  status: Row<'statuses'>;
  /** ids captured when asked; the dialog shows their live state */
  subtaskIds: string[];
  commentIds: string[];
  checklistIds: string[];
  answer: (ok: boolean) => void;
};
export const closePrompt = shallowRef<ClosePrompt | null>(null);

const closed = (s: Row<'statuses'> | undefined) =>
  s?.category === 'done' || s?.category === 'cancelled';
const open = (s: Row<'statuses'> | undefined) => !!s && !closed(s);

/** true — go on with the status change; false — cancelled */
export async function confirmDone(taskId: string, statusId: string): Promise<boolean> {
  const [task, next] = await Promise.all([
    db.table<Row<'tasks'>>('tasks').get(taskId),
    db.table<Row<'statuses'>>('statuses').get(statusId),
  ]);
  if (!task || !next || !closed(next) || task.statusId === statusId) return true;
  const cur = await db.table<Row<'statuses'>>('statuses').get(task.statusId);
  if (closed(cur)) return true;
  // C-sync v3 (PLNRAPP-487): comments are task details — by the counters there are open assigned ones,
  // but the details are not in the replica and cannot be loaded: do not decide on incomplete data
  const unresolved = (task.commentsAssigned ?? 0) > (task.commentsResolved ?? 0);
  if (unresolved && !(await loadDetails(taskId))) {
    toast(i18n.global.t('closeOpen.offline'));
    return false;
  }
  const [kids, comments, items] = await Promise.all([
    db.table<Row<'tasks'>>('tasks').where('parentId').equals(taskId).toArray(),
    db.table<Row<'comments'>>('comments').where('taskId').equals(taskId).toArray(),
    db.table<Row<'checklistItems'>>('checklistItems').where('taskId').equals(taskId).toArray(),
  ]);
  const statuses = await db
    .table<Row<'statuses'>>('statuses')
    .bulkGet([...new Set(kids.map((k) => k.statusId))]);
  const st = new Map(statuses.flatMap((s) => (s ? [[s.id, s] as const] : [])));
  const subtaskIds = kids.filter((k) => open(st.get(k.statusId))).map((k) => k.id);
  const commentIds = comments.filter((c) => c.assigneeId && !c.resolvedAt).map((c) => c.id);
  const checklistIds = items
    .filter((i) => !i.done)
    .sort((a, b) => (a.rank < b.rank ? -1 : 1))
    .map((i) => i.id);
  if (!subtaskIds.length && !commentIds.length && !checklistIds.length) return true;
  closePrompt.value?.answer(false);
  return new Promise<boolean>((resolve) => {
    closePrompt.value = {
      task,
      status: next,
      subtaskIds,
      commentIds,
      checklistIds,
      answer: (ok) => {
        closePrompt.value = null;
        resolve(ok);
      },
    };
  });
}

/**
 * The status an open subtask goes to with its parent (PLNRAPP-805): the parent's one in its project,
 * in another project — a closed one with the same name, else the first of the same category; none — undefined.
 */
export function closeStatusFor(
  kid: Pick<Row<'tasks'>, 'projectId'>,
  to: Row<'statuses'>,
  statuses: Row<'statuses'>[],
): Row<'statuses'> | undefined {
  if (kid.projectId === to.projectId) return to;
  const own = statuses
    .filter((s) => s.projectId === kid.projectId && closed(s))
    .sort((a, b) => (a.rank < b.rank ? -1 : 1));
  const name = to.name.trim().toLowerCase();
  return (
    own.find((s) => s.name.trim().toLowerCase() === name) ??
    own.find((s) => s.category === to.category)
  );
}

/** «Close all»: open subtasks — to the task's status (closeStatusFor), checklist items — done, open comments — resolved */
export async function closeAll(p: ClosePrompt): Promise<void> {
  const [kids, comments, items] = await Promise.all([
    db.table<Row<'tasks'>>('tasks').bulkGet(p.subtaskIds),
    db.table<Row<'comments'>>('comments').bulkGet(p.commentIds),
    db.table<Row<'checklistItems'>>('checklistItems').bulkGet(p.checklistIds),
  ]);
  const statuses = await db.table<Row<'statuses'>>('statuses').toArray();
  for (const k of kids) {
    if (!k || !open(statuses.find((s) => s.id === k.statusId))) continue;
    const to = closeStatusFor(k, p.status, statuses);
    if (to) await mutate('task.update', { id: k.id, statusId: to.id });
  }
  for (const i of items) {
    if (!i || i.done) continue;
    await mutate('checklist.update', { id: i.id, done: true });
  }
  for (const c of comments) {
    if (!c || c.resolvedAt) continue;
    // resolves the assignee, author or admin — someone else's comment stays open
    await mutate('comment.resolve', { id: c.id, resolved: true }).catch(() => undefined);
  }
}
