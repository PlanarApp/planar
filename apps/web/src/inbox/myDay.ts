import type { Row } from '@planar/shared';
import { mutate } from '../sync';
import type { TaskGroup } from '../tasks/group';
import type { TaskView } from '../tasks/queries';
import { sortTasks } from '../tasks/sort';
import { localToday, type Filter } from '../views/filter';

/**
 * «My day» (PLANARAPP-10, PLNRAPP-864, PLNRAPP-868): the List of the level with a fixed filter — my unfinished
 * tasks (I am an assignee) with a due date; tasks without one are not in the day. No separate query: the data
 * is the List's (useScopeTasks), so a due date change moves the task between the blocks at once.
 */
export const MY_DAY_FILTER: Filter = {
  op: 'and',
  rules: [
    { field: 'assignee', operator: 'in', value: ['me'] },
    { field: 'dueDate', operator: 'isNotEmpty' },
    { field: 'statusCategory', operator: 'notIn', value: ['done', 'cancelled'] },
  ],
};

export type DayBlock = 'today' | 'tomorrow' | 'later';
export const DAY_BLOCKS: DayBlock[] = ['today', 'tomorrow', 'later'];

/** the block of a due date: today and overdue — «Today», tomorrow — «Tomorrow», after it — «Later» */
export function dayBlock(
  dueDate: string,
  today = localToday(),
  tomorrow = localToday(1),
): DayBlock {
  return dueDate <= today ? 'today' : dueDate <= tomorrow ? 'tomorrow' : 'later';
}

/**
 * The blocks «Today / Tomorrow / Later» (PLNRAPP-868) instead of the "View" grouping and sorting: all three,
 * empty ones too; inside — by due date, then in the manual order. Tasks without a due date are dropped.
 */
export function dayBlocks(tasks: TaskView[], label: (b: DayBlock) => string): TaskGroup[] {
  const today = localToday();
  const tomorrow = localToday(1);
  const by = new Map<DayBlock, TaskView[]>(DAY_BLOCKS.map((b) => [b, []]));
  for (const x of sortTasks(sortTasks(tasks, 'rank', 'asc'), 'dueDate', 'asc'))
    if (x.dueDate) by.get(dayBlock(x.dueDate, today, tomorrow))!.push(x);
  return DAY_BLOCKS.map((b) => ({ key: b, label: label(b), tasks: by.get(b)! }));
}

/** set the task's due date (null — clear it) */
export const setDue = (taskId: string, dueDate: string | null) =>
  mutate('task.update', { id: taskId, dueDate });

/** «On today»: due today */
export const planToday = (taskId: string) => setDue(taskId, localToday());

/** clears the due date */
export const unplan = (taskId: string) => setDue(taskId, null);

/** D in the List and in a task (PLNRAPP-80, PLNRAPP-79): due today, or clear the due date if it is today */
export const toggleToday = (task: Pick<Row<'tasks'>, 'id' | 'dueDate'>) =>
  task.dueDate === localToday() ? unplan(task.id) : planToday(task.id);

/** «Due date» menu (PLNRAPP-137): due on that date */
export const planFor = (taskId: string, date: string) => setDue(taskId, date);
