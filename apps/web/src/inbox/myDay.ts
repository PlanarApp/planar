import type { Row } from '@planar/shared';
import { mutate } from '../sync';
import { localToday, type Filter } from '../views/filter';

/**
 * «My day» (PLANARAPP-10, PLNRAPP-864): the List of the level with a fixed filter — my tasks (I am an assignee)
 * due today (any status) and unfinished ones due earlier. No separate query: the data is the List's
 * (useScopeTasks), so a due date change moves the task in or out of the day at once.
 */
export const MY_DAY_FILTER: Filter = {
  op: 'and',
  rules: [{ field: 'assignee', operator: 'in', value: ['me'] }],
  groups: [
    {
      op: 'or',
      rules: [],
      groups: [
        {
          op: 'and',
          rules: [
            { field: 'dueDate', operator: 'after', value: 'today-1' },
            { field: 'dueDate', operator: 'before', value: 'today+1' },
          ],
        },
        {
          op: 'and',
          rules: [
            { field: 'dueDate', operator: 'before', value: 'today' },
            { field: 'statusCategory', operator: 'notIn', value: ['done', 'cancelled'] },
          ],
        },
      ],
    },
  ],
};

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
