import { addDays, todayIn } from '../shared/index.js';

export interface BurnupData {
  days: string[];
  /** объём — число задач цикла сейчас, одна линия на все дни */
  scope: number;
  /** сделано нарастающим итогом; null — день в будущем */
  done: (number | null)[];
}

/** Burn-up цикла: done(день) = задачи с completedAt ≤ дня (по часовому поясу проекта). */
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
