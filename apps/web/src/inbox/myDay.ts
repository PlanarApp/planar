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
  /** planned for an earlier day and not done — offered to carry over */
  carry: DayItem[];
  /** ids of tasks planned for today */
  planned: Set<string>;
};

export const useMyDay = (userId: () => string | undefined) =>
  useQuery(async (): Promise<MyDay> => {
    const uid = userId();
    const empty = { today: [], carry: [], planned: new Set<string>() };
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
    const todays = items
      .filter((x) => x.plan.date === today)
      .sort((a, b) => (a.plan.rank < b.plan.rank ? -1 : a.plan.rank > b.plan.rank ? 1 : 0));
    const planned = new Set(todays.map((x) => x.task.id));
    // one row per task: the latest earlier day
    const carry = new Map<string, DayItem>();
    for (const x of items)
      if (x.plan.date < today && !x.done && !planned.has(x.task.id)) {
        const seen = carry.get(x.task.id);
        if (!seen || seen.plan.date < x.plan.date) carry.set(x.task.id, x);
      }
    return { today: todays, carry: [...carry.values()], planned };
  });

const lastRank = (day: MyDay | undefined) => day?.today.at(-1)?.plan.rank ?? null;

/** add a task to the end of today's plan */
export const planToday = (taskId: string, day: MyDay | undefined) =>
  mutate('day.plan', {
    id: newId(),
    taskId,
    date: localToday(),
    rank: rankBetween(lastRank(day), null),
  });

/** earlier unfinished plans → the end of today, keeping their order */
export async function carryOver(day: MyDay) {
  let rank = lastRank(day);
  for (const x of day.carry) {
    rank = rankBetween(rank, null);
    await mutate('day.move', { id: x.plan.id, date: localToday(), rank });
  }
}

export const unplan = (planId: string) => mutate('day.remove', { id: planId });

/** put a plan at position `index` of today's order (drag and drop): rank between the neighbours without it */
export function moveTo(day: MyDay, planId: string, index: number) {
  const others = day.today.filter((x) => x.plan.id !== planId);
  const rank = rankBetween(others[index - 1]?.plan.rank ?? null, others[index]?.plan.rank ?? null);
  return mutate('day.move', { id: planId, rank });
}

/** move a plan to tomorrow; it shows up in «My day» when tomorrow comes */
export const tomorrow = (planId: string) => mutate('day.move', { id: planId, date: localToday(1) });
