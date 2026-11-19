import type { Row } from '@planar/shared';
import { db, useQuery } from '../sync';
import { views as taskViews } from '../tasks/queries';

const byStr =
  <T>(f: (x: T) => string) =>
  (a: T, b: T) =>
    f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0;

// fn reads db — liveQuery subscribes to the table; taskId is constant for the component's lifetime
const byTask = <R>(table: string, taskId: string) =>
  db.table<R>(table).where('taskId').equals(taskId).toArray();

export const useUsers = () => useQuery(() => db.table<Row<'users'>>('users').toArray());

export const useChecklist = (taskId: string) =>
  useQuery(async () =>
    (await byTask<Row<'checklistItems'>>('checklistItems', taskId)).sort(byStr((x) => x.rank)),
  );

export const useComments = (taskId: string) =>
  useQuery(async () =>
    (await byTask<Row<'comments'>>('comments', taskId)).sort(byStr((x) => x.createdAt)),
  );

/** task attachments (not comments) */
export const useAttachments = (taskId: string) =>
  useQuery(async () =>
    (await byTask<Row<'attachments'>>('attachments', taskId))
      .filter((a) => !a.commentId)
      .sort(byStr((x) => x.createdAt)),
  );

/** files of the task's comments by comment (PLNRAPP-372) */
export const useCommentFiles = (taskId: string) =>
  useQuery(async () => {
    const m = new Map<string, Row<'attachments'>[]>();
    for (const a of (await byTask<Row<'attachments'>>('attachments', taskId)).sort(
      byStr((x) => x.createdAt),
    ))
      if (a.commentId) (m.get(a.commentId) ?? m.set(a.commentId, []).get(a.commentId)!).push(a);
    return m;
  });

export const useWatchers = (taskId: string) =>
  useQuery(() => byTask<Row<'taskWatchers'>>('taskWatchers', taskId));

export const useSubtasks = (taskId: string) =>
  useQuery(async () => {
    const rows = (
      await db.table<Row<'tasks'>>('tasks').where('parentId').equals(taskId).toArray()
    ).filter((r) => !r.archivedAt);
    const keys = new Map<string, string>();
    for (const p of await db
      .table<Row<'projects'>>('projects')
      .bulkGet([...new Set(rows.map((r) => r.projectId))]))
      if (p) keys.set(p.id, p.key);
    // TaskView (assignees, labels): the rows are the List's Row (PLNRAPP-540)
    return taskViews(rows.sort(byStr((x) => x.rank)), keys);
  });

/** reactions to all comments of the task in one query */
export const useReactions = (taskId: string) =>
  useQuery(async () => {
    const ids = (await byTask<Row<'comments'>>('comments', taskId)).map((c) => c.id);
    return db
      .table<Row<'commentReactions'>>('commentReactions')
      .where('commentId')
      .anyOf(ids)
      .toArray();
  });
