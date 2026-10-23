import { db, mutate, newId, rankBetween } from '../sync';
import type { Row } from '@planar/shared';

export interface CreateTaskArgs {
  projectId: string;
  statusId: string;
  title: string;
  after?: string | null;
  before?: string | null;
  parentId?: string | null;
  priority?: number;
  dueDate?: string | null;
  assigneeIds?: string[];
  labelIds?: string[];
}

/** rank последней задачи проекта в статусе */
async function lastRank(projectId: string, statusId: string): Promise<string | null> {
  let max: string | null = null;
  await db
    .table<Row<'tasks'>>('tasks')
    .where('projectId')
    .equals(projectId)
    .each((t) => {
      if (t.statusId === statusId && (max === null || t.rank > max)) max = t.rank;
    });
  return max;
}

export async function createTask(a: CreateTaskArgs): Promise<string> {
  const id = newId();
  const rank =
    a.after === undefined && a.before === undefined
      ? rankBetween(await lastRank(a.projectId, a.statusId), null)
      : rankBetween(a.after ?? null, a.before ?? null);
  await mutate('task.create', {
    id,
    projectId: a.projectId,
    statusId: a.statusId,
    title: a.title,
    rank,
    parentId: a.parentId,
    priority: a.priority,
    dueDate: a.dueDate,
    assignees: a.assigneeIds?.map((userId) => ({ id: newId(), userId })),
    labels: a.labelIds?.map((labelId) => ({ id: newId(), labelId })),
  });
  return id;
}

export type TaskPatch = Partial<
  Pick<
    Row<'tasks'>,
    | 'title'
    | 'description'
    | 'statusId'
    | 'priority'
    | 'dueDate'
    | 'startDate'
    | 'projectId'
    | 'parentId'
    | 'fields'
  >
>;
export const updateTask = (id: string, patch: TaskPatch): Promise<void> =>
  mutate('task.update', { id, ...patch });

export const moveTask = (
  id: string,
  to: { statusId?: string; after: string | null; before: string | null },
): Promise<void> =>
  mutate('task.update', {
    id,
    rank: rankBetween(to.after, to.before),
    ...(to.statusId !== undefined && { statusId: to.statusId }),
  });

export const deleteTask = (id: string): Promise<void> => mutate('task.delete', { id });

/** Разница нужного набора с связями в реплике → add/remove мутации. */
async function diff(
  table: 'taskAssignees' | 'taskLabels',
  field: 'userId' | 'labelId',
  taskId: string,
  want: string[],
  add: (v: string) => Promise<void>,
  remove: (v: string) => Promise<void>,
) {
  const rows = await db
    .table<Record<string, string>>(table)
    .where('taskId')
    .equals(taskId)
    .toArray();
  const have = new Set(rows.map((r) => r[field]));
  const w = new Set(want);
  for (const v of w) if (!have.has(v)) await add(v);
  for (const v of have) if (!w.has(v)) await remove(v);
}

export const setAssignees = (taskId: string, userIds: string[]): Promise<void> =>
  diff(
    'taskAssignees',
    'userId',
    taskId,
    userIds,
    (userId) => mutate('task.assign', { id: newId(), taskId, userId }),
    (userId) => mutate('task.unassign', { taskId, userId }),
  );

export const setLabels = (taskId: string, labelIds: string[]): Promise<void> =>
  diff(
    'taskLabels',
    'labelId',
    taskId,
    labelIds,
    (labelId) => mutate('task.addLabel', { id: newId(), taskId, labelId }),
    (labelId) => mutate('task.removeLabel', { taskId, labelId }),
  );
