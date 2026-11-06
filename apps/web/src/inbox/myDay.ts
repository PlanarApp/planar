import type { Row } from '@planar/shared';
import { db, mutate, newId, rankBetween, useQuery } from '../sync';
import { localToday } from '../views/filter';

/** «My day» (PLANARAPP-10): the user's plan of tasks for today, synced between devices (dayPlans). */

export type DayItem = {
  plan: Row<'dayPlans'>;
  task: Row<'tasks'>;
  key: string;
  project: string;
  status: Row<'statuses'>;
  done: boolean;
};
export type MyDay = {
  /** today's plan in the user's order (done tasks stay, struck through) */
  today: DayItem[];
  /** tomorrow's plan in the user's order (PLANARAPP-58) */
  tomorrow: DayItem[];
  /** planned after tomorrow: by date, then order */
  later: DayItem[];
  /** planned for an earlier day and not done — offered to carry over */
  carry: DayItem[];
  /** ids of tasks planned for today or later */
  planned: Set<string>;
};

export const useMyDay = (userId: () => string | undefined) =>
  useQuery(async (): Promise<MyDay> => {
    const uid = userId();
    const empty = { today: [], tomorrow: [], later: [], carry: [], planned: new Set<string>() };
    if (!uid) return empty;
    const plans = (await db.table<Row<'dayPlans'>>('dayPlans').toArray()).filter(
      (p) => p.userId === uid,
    );
    const tasks = await db.table<Row<'tasks'>>('tasks').bulkGet(plans.map((p) => p.taskId));
    const live = tasks.filter((t): t is Row<'tasks'> => !!t);
    const [statuses, projects] = await Promise.all([
      db.table<Row<'statuses'>>('statuses').bulkGet([...new Set(live.map((t) => t.statusId))]),
      db.table<Row<'projects'>>('projects').bulkGet([...new Set(live.map((t) => t.projectId))]),
    ]);
    const st = new Map(statuses.flatMap((s) => (s ? [[s.id, s] as const] : [])));
    const pr = new Map(projects.flatMap((p) => (p ? [[p.id, p] as const] : [])));
    const today = localToday();
    const next = localToday(1);
    // a deleted or invisible task: its plan row is skipped (dayPlans.taskId has no FK)
    const items = plans.flatMap((plan, i) => {
      const task = tasks[i];
      const status = task && st.get(task.statusId);
      if (!task || !status) return [];
      const p = pr.get(task.projectId);
      const done = status.category === 'done' || status.category === 'cancelled';
      const key = `${p?.key ?? '?'}-${task.number ?? '…'}`;
      return [{ plan, task, key, project: p?.name ?? '', status, done }];
    });
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const byRank = (a: DayItem, b: DayItem) => cmp(a.plan.rank, b.plan.rank);
    const on = (d: string) => items.filter((x) => x.plan.date === d).sort(byRank);
    const todays = on(today);
    const tomorrows = on(next);
    const later = items
      .filter((x) => x.plan.date > next)
      .sort((a, b) => cmp(a.plan.date, b.plan.date) || byRank(a, b));
    const planned = new Set([...todays, ...tomorrows, ...later].map((x) => x.task.id));
    // one row per task: the latest earlier day
    const carry = new Map<string, DayItem>();
    for (const x of items)
      if (x.plan.date < today && !x.done && !planned.has(x.task.id)) {
        const seen = carry.get(x.task.id);
        if (!seen || seen.plan.date < x.plan.date) carry.set(x.task.id, x);
      }
    return { today: todays, tomorrow: tomorrows, later, carry: [...carry.values()], planned };
  });

/** the plan limited to tasks of these projects (a node of «My work» and its nested ones) */
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

const lastRank = (day: MyDay | undefined) => day?.today.at(-1)?.plan.rank ?? null;

/** add a task to the end of today's plan */
export const planToday = (taskId: string, day: MyDay | undefined) =>
  mutate('day.plan', {
    id: newId(),
    taskId,
    date: localToday(),
    rank: rankBetween(lastRank(day), null),
  });

async function moveAll(items: DayItem[], date: string, after: string | null) {
  let rank = after;
  for (const x of items) {
    rank = rankBetween(rank, null);
    await mutate('day.move', { id: x.plan.id, date, rank });
  }
}

/** earlier unfinished plans → the end of today, keeping their order */
export const carryOver = (day: MyDay) => moveAll(day.carry, localToday(), lastRank(day));

/** today's unfinished plans → the end of tomorrow (the end-of-day review) */
export const postpone = (day: MyDay) =>
  moveAll(
    day.today.filter((x) => !x.done),
    localToday(1),
    day.tomorrow.at(-1)?.plan.rank ?? null,
  );

export const unplan = (planId: string) => mutate('day.remove', { id: planId });

/** D in the List and in a task (PLNRAPP-80, PLNRAPP-79): add to today's plan or remove from it */
export function toggleToday(taskId: string, day: MyDay | undefined) {
  const plan = day?.today.find((x) => x.task.id === taskId)?.plan;
  return plan ? unplan(plan.id) : planToday(taskId, day);
}

/** put a plan at position `index` of a day's order (drag and drop; from another day — with its `date`):
 * rank between the neighbours without it */
export function moveTo(list: DayItem[], planId: string, index: number, date?: string) {
  const others = list.filter((x) => x.plan.id !== planId);
  const rank = rankBetween(others[index - 1]?.plan.rank ?? null, others[index]?.plan.rank ?? null);
  return mutate('day.move', { id: planId, rank, ...(date && { date }) });
}

/** move a plan to another date, to the end of that day */
export function reschedule(day: MyDay, planId: string, date: string) {
  const last = [...day.today, ...day.tomorrow, ...day.later]
    .filter((x) => x.plan.date === date && x.plan.id !== planId)
    .at(-1);
  return mutate('day.move', { id: planId, date, rank: rankBetween(last?.plan.rank ?? null, null) });
}
