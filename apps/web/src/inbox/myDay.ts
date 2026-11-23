import type { Row } from '@planar/shared';
import { db, mutate, mutateMany, useQuery } from '../sync';
import { localToday } from '../views/filter';

/**
 * «My day» (PLANARAPP-10, PLNRAPP-709): my tasks (I am an assignee) by their due date — today, tomorrow, later;
 * unfinished ones due earlier are offered to carry over. The buttons change the task's dueDate.
 */

export type DayItem = {
  task: Row<'tasks'>;
  key: string;
  project: string;
  status: Row<'statuses'>;
  done: boolean;
};
export type MyDay = {
  /** due today (done tasks stay, struck through) */
  today: DayItem[];
  /** due tomorrow, not done (PLANARAPP-58) */
  tomorrow: DayItem[];
  /** due after tomorrow, not done */
  later: DayItem[];
  /** due on an earlier day and not done — offered to carry over to today */
  carry: DayItem[];
  /** ids of tasks due today or later */
  planned: Set<string>;
};

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);
/** priority 0 («none») goes after 4 («low») */
const prio = (p: number) => p || 5;
/** by dueDate, then priority, then key (project key and number) */
export const byDue = (a: DayItem, b: DayItem) =>
  cmp(a.task.dueDate ?? '', b.task.dueDate ?? '') ||
  cmp(prio(a.task.priority), prio(b.task.priority)) ||
  cmp(a.key.replace(/-.*$/, ''), b.key.replace(/-.*$/, '')) ||
  cmp(a.task.number ?? Infinity, b.task.number ?? Infinity) ||
  cmp(a.task.id, b.task.id);

export const useMyDay = (userId: () => string | undefined) =>
  useQuery(async (): Promise<MyDay> => {
    const uid = userId();
    const empty = { today: [], tomorrow: [], later: [], carry: [], planned: new Set<string>() };
    if (!uid) return empty;
    const links = await db
      .table<Row<'taskAssignees'>>('taskAssignees')
      .where('userId')
      .equals(uid)
      .toArray();
    const tasks = (
      await db.table<Row<'tasks'>>('tasks').bulkGet([...new Set(links.map((a) => a.taskId))])
    ).filter((t): t is Row<'tasks'> => !!t && !t.archivedAt && !!t.dueDate);
    const [statuses, projects] = await Promise.all([
      db.table<Row<'statuses'>>('statuses').bulkGet([...new Set(tasks.map((t) => t.statusId))]),
      db.table<Row<'projects'>>('projects').bulkGet([...new Set(tasks.map((t) => t.projectId))]),
    ]);
    const st = new Map(statuses.flatMap((s) => (s ? [[s.id, s] as const] : [])));
    const pr = new Map(projects.flatMap((p) => (p ? [[p.id, p] as const] : [])));
    const today = localToday();
    const next = localToday(1);
    const items = tasks
      .flatMap((task) => {
        const status = st.get(task.statusId);
        if (!status) return [];
        const p = pr.get(task.projectId);
        const done = status.category === 'done' || status.category === 'cancelled';
        const key = `${p?.key ?? '?'}-${task.number ?? '…'}`;
        return [{ task, key, project: p?.name ?? '', status, done }];
      })
      .sort(byDue);
    const due = (x: DayItem) => x.task.dueDate!;
    const todays = items.filter((x) => due(x) === today);
    const tomorrows = items.filter((x) => due(x) === next && !x.done);
    const later = items.filter((x) => due(x) > next && !x.done);
    const carry = items.filter((x) => due(x) < today && !x.done);
    const planned = new Set([...todays, ...tomorrows, ...later].map((x) => x.task.id));
    return { today: todays, tomorrow: tomorrows, later, carry, planned };
  });

/** the day limited to tasks of these projects (a node of «My work» and its nested ones) */
export function dayIn(day: MyDay, projectIds: string[]): MyDay {
  const ids = new Set(projectIds);
  const only = (xs: DayItem[]) => xs.filter((x) => ids.has(x.task.projectId));
  const [today, tomorrow, later] = [only(day.today), only(day.tomorrow), only(day.later)];
  return {
    today,
    tomorrow,
    later,
    carry: only(day.carry),
    planned: new Set([...today, ...tomorrow, ...later].map((x) => x.task.id)),
  };
}

/** set the task's due date (null — clear it) */
export const setDue = (taskId: string, dueDate: string | null) =>
  mutate('task.update', { id: taskId, dueDate });

/**
 * Bulk due date (PLNRAPP-813): one replica transaction for all tasks — not a commit, a replica event and
 * a push/pull rebase per task, which on a phone took ~1 s per task
 */
const setAll = (items: DayItem[], date: string) =>
  mutateMany(items.map((x) => ({ name: 'task.update', input: { id: x.task.id, dueDate: date } })));

/** «On today»: due today */
export const planToday = (taskId: string) => setDue(taskId, localToday());

/** «Carry over to today»: unfinished tasks due earlier → due today */
export const carryOver = (day: MyDay) => setAll(day.carry, localToday());

/** today's unfinished tasks → due tomorrow (the end-of-day review) */
export const postpone = (day: MyDay) =>
  setAll(
    day.today.filter((x) => !x.done),
    localToday(1),
  );

/** «Remove from the day»: clears the due date */
export const unplan = (taskId: string) => setDue(taskId, null);

/** D in the List and in a task (PLNRAPP-80, PLNRAPP-79): due today, or clear the due date if it is today */
export const toggleToday = (task: Pick<Row<'tasks'>, 'id' | 'dueDate'>) =>
  task.dueDate === localToday() ? unplan(task.id) : planToday(task.id);

/** «Due date» menu (PLNRAPP-137): due on that date */
export const planFor = (taskId: string, date: string) => setDue(taskId, date);
