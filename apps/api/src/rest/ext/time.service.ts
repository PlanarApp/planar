import { eq, getTableColumns, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { HttpError } from '../../auth/errors.js';
import { moduleTables } from '../../modules/installed.js';
import { toWire } from '../../sync/rows.js';
import { findTask } from './tasks.service.js';
import type { ExtDeps } from './types.js';

const notFound = (what: string) => new HttpError(404, 'not_found', `${what} не найден`);
const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** table of a module entity and its columns (the core does not know module types) */
const tbl = (entity: string) => {
  const t = moduleTables().get(entity)!;
  return { t, c: getTableColumns(t) as Record<string, PgColumn> };
};

/** the task of a time entry, visible to the user and with the time module on; otherwise 404 */
export async function entryTask(d: ExtDeps, userId: string, id: string) {
  const { t, c } = tbl('timeEntries');
  const [e] = isUuid(id) ? await d.db.select().from(t).where(eq(c.id!, id)) : [];
  if (!e) throw notFound('Запись времени');
  const task = await findTask(d, userId, e.taskId as string).catch(() => {
    throw notFound('Запись времени');
  });
  await d.moduleOn(userId, 'time', task.projectId);
  return task;
}

export async function entryRow(d: ExtDeps, id: string) {
  const { t, c } = tbl('timeEntries');
  const [e] = await d.db.select().from(t).where(eq(c.id!, id));
  return toWire('timeEntries', e as Record<string, unknown>);
}

export async function estimateOf(d: ExtDeps, taskId: string) {
  const { t, c } = tbl('timeEstimates');
  const [e] = await d.db.select().from(t).where(eq(c.taskId!, taskId));
  return e ? toWire('timeEstimates', e as Record<string, unknown>) : null;
}

/** time per user or per task in a project (entries with a duration), as the user sees the project */
export async function timeReport(
  d: ExtDeps,
  userId: string,
  q: { projectId: string; groupBy: 'user' | 'task'; from?: string; to?: string },
) {
  const pid = await d.visibleProject(userId, q.projectId);
  await d.moduleOn(userId, 'time', pid);
  const key = q.groupBy === 'user' ? sql`e.user_id` : sql`e.task_id`;
  const r = await d.db.execute(sql`select ${key}::text as key, count(*)::int as entries,
      coalesce(sum(e.duration_sec), 0)::int as "durationSec",
      coalesce(sum(e.duration_sec) filter (where e.billable), 0)::int as "billableSec"
    from time_entries e join tasks t on t.id = e.task_id
    where t.project_id = ${pid}::uuid and e.duration_sec is not null
      ${q.from ? sql`and e.started_at >= ${q.from}::timestamptz` : sql``}
      ${q.to ? sql`and e.started_at <= ${q.to}::timestamptz` : sql``}
    group by 1 order by 3 desc, 1`);
  return r.rows as { key: string; entries: number; durationSec: number; billableSec: number }[];
}

/** 404 module_disabled unless the workload module is on in some project of the space */
export async function workloadOn(d: ExtDeps, spaceId: string) {
  const r = await d.db.execute(
    sql`select 1 from projects where space_id = ${spaceId}::uuid and 'workload' = any(modules) limit 1`,
  );
  if (!r.rows.length) throw new HttpError(404, 'module_disabled', 'Модуль workload выключен');
}

/** weekly capacity of every space member: hoursPerWeek or null when not set */
export async function capacities(d: ExtDeps, spaceId: string) {
  const r = await d.db.execute(sql`select m.user_id as "userId", u.login, u.name, m.role,
      w.hours_per_week as "hoursPerWeek"
    from space_members m join users u on u.id = m.user_id
    left join workload_capacities w on w.space_id = m.space_id and w.user_id = m.user_id
    where m.space_id = ${spaceId}::uuid order by u.name, m.user_id`);
  return r.rows;
}

export async function ruleOf(d: ExtDeps, taskId: string) {
  const { t, c } = tbl('recurringRules');
  const [e] = await d.db.select().from(t).where(eq(c.taskId!, taskId));
  return e ? toWire('recurringRules', e as Record<string, unknown>) : null;
}
