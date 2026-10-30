import { addDays, todayIn } from '../shared/index.js';

export interface BurnupData {
  days: string[];
  /** volume — the number of the cycle's tasks now, one line for all days */
  scope: number;
  /** done so far as a running total; null — a day in the future */
  done: (number | null)[];
}

/** Cycle burn-up: done(day) = tasks with completedAt ≤ day (in the project's time zone). */
export function burnup(
  cycle: { startDate: string; endDate: string },
  tasks: { completedAt: string | null }[],
  today: string,
  timeZone: string,
): BurnupData {
  const days: string[] = [];
  for (let d = cycle.startDate; d <= cycle.endDate && days.length < 366; d = addDays(d, 1))
    days.push(d);
  const doneDays = tasks.flatMap((t) =>
    t.completedAt ? [todayIn(timeZone, new Date(t.completedAt))] : [],
  );
  return {
    days,
    scope: tasks.length,
    done: days.map((d) => (d > today ? null : doneDays.filter((x) => x <= d).length)),
  };
}
