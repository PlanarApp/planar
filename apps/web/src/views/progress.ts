import type { Row } from '@planar/shared';
import { db, useQuery } from '../sync';

export type Ratio = { done: number; total: number };
export type TaskProgress = { subtasks: Ratio; checklist: Ratio };

const CLOSED = ['done', 'cancelled'];

/** PLNRAPP-333: closed / total subtasks (not archived; closed — the status of category done/cancelled,
 * as on the task tabs) and done / total checklist items */
export function progressOf(
  subtasks: Pick<Row<'tasks'>, 'statusId' | 'archivedAt'>[],
  statuses: (Pick<Row<'statuses'>, 'id' | 'category'> | undefined)[],
  checklist: Pick<Row<'checklistItems'>, 'done'>[],
): TaskProgress {
  const cat = new Map(statuses.filter((s) => !!s).map((s) => [s!.id, s!.category]));
  const live = subtasks.filter((s) => !s.archivedAt);
  return {
    subtasks: {
      done: live.filter((s) => CLOSED.includes(cat.get(s.statusId) ?? '')).length,
      total: live.length,
    },
    checklist: { done: checklist.filter((i) => i.done).length, total: checklist.length },
  };
}

/** progress of one task from the replica (by the indexes parentId / taskId) */
export const useTaskProgress = (taskId: string) =>
  useQuery(async () => {
    const [subtasks, checklist] = await Promise.all([
      db.table<Row<'tasks'>>('tasks').where('parentId').equals(taskId).toArray(),
      db.table<Row<'checklistItems'>>('checklistItems').where('taskId').equals(taskId).toArray(),
    ]);
    const statuses = await db
      .table<Row<'statuses'>>('statuses')
      .bulkGet([...new Set(subtasks.map((s) => s.statusId))]);
    return progressOf(subtasks, statuses, checklist);
  });
