import type { Row } from '@planar/shared';
import { db, useQuery } from '../sync';

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

export const useWatchers = (taskId: string) =>
  useQuery(() => byTask<Row<'taskWatchers'>>('taskWatchers', taskId));

export const useSubtasks = (taskId: string) =>
  useQuery(async () => {
    const rows = await db.table<Row<'tasks'>>('tasks').where('parentId').equals(taskId).toArray();
    const keys = new Map<string, string>();
    for (const p of await db
      .table<Row<'projects'>>('projects')
      .bulkGet([...new Set(rows.map((r) => r.projectId))]))
      if (p) keys.set(p.id, p.key);
    return rows
      .sort(byStr((x) => x.rank))
      .map((r) => ({ ...r, key: `${keys.get(r.projectId) ?? '?'}-${r.number ?? '…'}` }));
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
