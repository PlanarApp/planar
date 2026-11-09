import { shallowRef } from 'vue';
import type { Row } from '@planar/shared';
import { db, mutate } from '../sync';

/** Completing a task with open subtasks or open assigned comments (PLNRAPP-138): ask what to do with them. */

export type ClosePrompt = {
  task: Row<'tasks'>;
  /** ids captured when asked; the dialog shows their live state */
  subtaskIds: string[];
  commentIds: string[];
  answer: (ok: boolean) => void;
};
export const closePrompt = shallowRef<ClosePrompt | null>(null);

const open = (s: Row<'statuses'> | undefined) =>
  !!s && s.category !== 'done' && s.category !== 'cancelled';

/** true — go on with the status change; false — cancelled */
export async function confirmDone(taskId: string, statusId: string): Promise<boolean> {
  const [task, next] = await Promise.all([
    db.table<Row<'tasks'>>('tasks').get(taskId),
    db.table<Row<'statuses'>>('statuses').get(statusId),
  ]);
  if (!task || next?.category !== 'done' || task.statusId === statusId) return true;
  const cur = await db.table<Row<'statuses'>>('statuses').get(task.statusId);
  if (cur?.category === 'done') return true;
  const [kids, comments] = await Promise.all([
    db.table<Row<'tasks'>>('tasks').where('parentId').equals(taskId).toArray(),
    db.table<Row<'comments'>>('comments').where('taskId').equals(taskId).toArray(),
  ]);
  const statuses = await db
    .table<Row<'statuses'>>('statuses')
    .bulkGet([...new Set(kids.map((k) => k.statusId))]);
  const st = new Map(statuses.flatMap((s) => (s ? [[s.id, s] as const] : [])));
  const subtaskIds = kids.filter((k) => open(st.get(k.statusId))).map((k) => k.id);
  const commentIds = comments.filter((c) => c.assigneeId && !c.resolvedAt).map((c) => c.id);
  if (!subtaskIds.length && !commentIds.length) return true;
  closePrompt.value?.answer(false);
  return new Promise<boolean>((resolve) => {
    closePrompt.value = {
      task,
      subtaskIds,
      commentIds,
      answer: (ok) => {
        closePrompt.value = null;
        resolve(ok);
      },
    };
  });
}

/** «Close all»: open subtasks — to the first «done» status of their project, open comments — resolved */
export async function closeAll(p: ClosePrompt): Promise<void> {
  const [kids, comments] = await Promise.all([
    db.table<Row<'tasks'>>('tasks').bulkGet(p.subtaskIds),
    db.table<Row<'comments'>>('comments').bulkGet(p.commentIds),
  ]);
  const statuses = await db.table<Row<'statuses'>>('statuses').toArray();
  for (const k of kids) {
    if (!k || !open(statuses.find((s) => s.id === k.statusId))) continue;
    const done = statuses
      .filter((s) => s.projectId === k.projectId && s.category === 'done')
      .sort((a, b) => (a.rank < b.rank ? -1 : 1))[0];
    if (done) await mutate('task.update', { id: k.id, statusId: done.id });
  }
  for (const c of comments) {
    if (!c || c.resolvedAt) continue;
    // resolves the assignee, author or admin — someone else's comment stays open
    await mutate('comment.resolve', { id: c.id, resolved: true }).catch(() => undefined);
  }
}
