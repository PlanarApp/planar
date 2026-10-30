import { z } from 'zod';
import { MutatorError, defineMutator, type SharedModuleManifest, type Tx } from '@planar/shared';

const ts = z.iso.datetime();
const date = z.iso.date();
const uuid = z.uuid();
const kinds = ['interval', 'weekdays', 'after_done'] as const;
const units = ['day', 'week', 'month'] as const;

export const recurringRules = z.object({
  id: uuid,
  spaceId: uuid,
  taskId: uuid,
  kind: z.enum(kinds),
  every: z.number().int(),
  unit: z.enum(units),
  weekdays: z.array(z.number().int().min(0).max(6)),
  anchorDate: date,
  nextDate: date.nullable(),
  timezone: z.string().min(1),
  createdBy: uuid,
  createdAt: ts,
  updatedAt: ts,
});
export type Rule = z.infer<typeof recurringRules>;
export type Schedule = Pick<Rule, 'kind' | 'every' | 'unit' | 'weekdays' | 'anchorDate'>;

// ---- pure functions: dates YYYY-MM-DD, days in UTC ----
const DAY = 86_400_000;
const toDays = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / DAY);
const fromDays = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const dow = (n: number) => (((n + 4) % 7) + 7) % 7; // 1970-01-01 — a Thursday
const monday = (n: number) => n - ((dow(n) + 6) % 7);
const monthIdx = (d: string) => Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1;

export const addDays = (d: string, n: number): string => fromDays(toDays(d) + n);
export const daysBetween = (from: string, to: string): number => toDays(to) - toDays(from);

/** d + n months; the day of month — min(day, days in the month). */
export function addMonths(d: string, n: number, day = Number(d.slice(8))): string {
  const t = monthIdx(d) + n;
  const y = Math.floor(t / 12);
  const m = t % 12;
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(Math.min(day, dim)).padStart(2, '0')}`;
}

/** The nearest schedule date strictly greater than `after`. */
export function nextOccurrence(rule: Schedule, after: string): string {
  const { kind, every, unit, anchorDate: a } = rule;
  if (kind === 'weekdays') {
    if (!rule.weekdays.length) throw new Error('weekdays пуст');
    const ws = monday(toDays(a));
    const from = Math.max(toDays(after) + 1, toDays(a));
    for (let d = from; d < from + 7 * every + 7; d++)
      if (rule.weekdays.includes(dow(d)) && ((monday(d) - ws) / 7) % every === 0)
        return fromDays(d);
    throw new Error('нет даты расписания');
  }
  if (kind !== 'interval') throw new Error('after_done не имеет расписания');
  if (unit !== 'month') {
    const step = every * (unit === 'week' ? 7 : 1);
    const diff = toDays(after) - toDays(a);
    return addDays(a, diff < 0 ? 0 : (Math.floor(diff / step) + 1) * step);
  }
  let k = Math.max(0, Math.floor((monthIdx(after) - monthIdx(a)) / every) - 1);
  for (; ; k++) {
    const o = addMonths(a, k * every);
    if (o > after) return o;
  }
}

/** Days from startDate to dueDate (0 if one of the dates is missing). */
export const spanOf = (t: { startDate: string | null; dueDate: string | null }): number =>
  t.startDate && t.dueDate ? daysBetween(t.startDate, t.dueDate) : 0;

/** The latest schedule date o ≥ nextDate with o − span ≤ today; none — null. */
export function duePeriod(
  rule: Schedule & { nextDate: string | null },
  today: string,
  span: number,
): string | null {
  if (rule.kind === 'after_done' || !rule.nextDate || addDays(rule.nextDate, -span) > today)
    return null;
  let o = rule.nextDate;
  for (;;) {
    const n = nextOccurrence(rule, o);
    if (addDays(n, -span) > today) return o;
    o = n;
  }
}

/** completedDate + every·unit. */
export function afterDoneDue(
  rule: Pick<Schedule, 'every' | 'unit'>,
  completedDate: string,
): string {
  return rule.unit === 'month'
    ? addMonths(completedDate, rule.every)
    : addDays(completedDate, rule.every * (rule.unit === 'week' ? 7 : 1));
}

/** Today's date in the time zone (an invalid IANA zone throws). */
export const todayIn = (timeZone: string, now = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);

// ---- mutators ----
interface ModTx {
  get<T>(e: string, id: string): Promise<T | undefined>;
  put(e: string, row: unknown): Promise<void>;
  patch(e: string, id: string, p: unknown): Promise<void>;
  del(e: string, id: string): Promise<void>;
  scan<T>(e: string, o: { index: string; eq: unknown }): Promise<T[]>;
}
const m = (tx: Tx) => tx as unknown as ModTx;
const bad = (msg: string) => new MutatorError('invalid_args', msg);
const rulesOf = (tx: Tx, taskId: string) =>
  m(tx).scan<Rule>('recurringRules', { index: 'taskId', eq: taskId });

export const set = defineMutator({
  name: 'recurring.set',
  args: z.object({
    id: uuid,
    taskId: uuid,
    kind: z.enum(kinds),
    every: z.number().int(),
    unit: z.enum(units),
    weekdays: z.array(z.number().int()),
    timezone: z.string().min(1),
    anchorDate: date.optional(),
  }),
  async run(tx, a, ctx) {
    const task = await tx.get('tasks', a.taskId);
    if (!task) throw new MutatorError('not_found', `task ${a.taskId}`);
    const wk = a.kind === 'weekdays';
    if (a.every < 1 || a.every > (wk ? 52 : 365)) throw bad(`every: ${a.every}`);
    if (wk && a.unit !== 'week') throw bad('weekdays: unit = week');
    if (wk ? !a.weekdays.length : a.weekdays.length) throw bad('weekdays не по виду повтора');
    if (a.weekdays.some((d, i) => d < 0 || d > 6 || (i && d <= a.weekdays[i - 1]!)))
      throw bad('weekdays: 0–6 по возрастанию без повторов');
    let today: string;
    try {
      today = todayIn(a.timezone, new Date(ctx.now));
    } catch {
      throw bad(`timezone: ${a.timezone}`);
    }
    const old = (await rulesOf(tx, a.taskId))[0];
    const taken = old ? undefined : await m(tx).get<Rule>('recurringRules', a.id);
    if (taken) throw bad('id занят правилом другой задачи');
    const anchorDate = a.anchorDate ?? task.dueDate ?? today;
    const rule: Rule = {
      id: old?.id ?? a.id,
      spaceId: task.spaceId,
      taskId: a.taskId,
      kind: a.kind,
      every: a.every,
      unit: a.unit,
      weekdays: a.weekdays,
      anchorDate,
      nextDate: null,
      timezone: a.timezone,
      createdBy: old?.createdBy ?? ctx.userId,
      createdAt: old?.createdAt ?? ctx.now,
      updatedAt: ctx.now,
    };
    if (a.kind !== 'after_done') rule.nextDate = nextOccurrence(rule, task.dueDate ?? anchorDate);
    await m(tx).put('recurringRules', rule);
  },
});

export const remove = defineMutator({
  name: 'recurring.remove',
  args: z.object({ taskId: uuid }),
  async run(tx, a) {
    for (const r of await rulesOf(tx, a.taskId)) await m(tx).del('recurringRules', r.id);
  },
});

export const advance = defineMutator({
  name: 'recurring.advance',
  args: z.object({ id: uuid, taskId: uuid, nextDate: date.nullable() }),
  async run(tx, a, ctx) {
    // MutatorCtx has no system: the system user is the only deactivated one who can run mutations
    const me = await tx.get('users', ctx.userId);
    if (!me?.deactivatedAt) throw new MutatorError('forbidden', 'только система');
    if (!(await m(tx).get<Rule>('recurringRules', a.id)))
      throw new MutatorError('not_found', `recurringRules ${a.id}`);
    await m(tx).patch('recurringRules', a.id, {
      taskId: a.taskId,
      nextDate: a.nextDate,
      updatedAt: ctx.now,
    });
  },
});

export const shared: SharedModuleManifest = {
  id: 'recurring',
  mutators: [set, remove, advance],
  entities: {
    recurringRules: {
      schema: recurringRules,
      meta: { scope: 'space', write: 'member', bootstrap: true, indexes: ['spaceId', 'taskId'] },
    },
  },
};
