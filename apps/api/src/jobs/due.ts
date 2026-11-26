import { sql } from 'drizzle-orm';
import { uuidv7 } from '@planar/shared';
import type { Db } from '../db/index.js';
import { projectAccess } from '../sync/project-access.js';
import { ServerTx } from '../sync/server-tx.js';

type Kind = 'due_today' | 'start_today' | 'due_soon' | 'due_now';

export const DUE_QUEUE = 'core.due.remind';
// every quarter of an hour: zones with :30/:45 offsets reach 9:00 off the UTC hour
export const DUE_CRON = '*/15 * * * *';

/**
 * PLNRAPP-161: at 9:xx in the profile's zone (unknown or empty — UTC) — to the assignees of open,
 * not archived tasks whose due date / start date is today there. A repeat within 20 h is skipped,
 * so every run of the hour (and a retry) is safe. Returns ids of new notifications (for push).
 */
export async function remindDue(db: Db, systemUserId: string, now = new Date()): Promise<string[]> {
  const at = now.toISOString();
  const { rows } = await db.execute<{
    userId: string;
    taskId: string;
    spaceId: string;
    projectId: string;
    kind: Kind;
    mark: string;
  }>(sql`
    with l as (
      select u.id, (${at}::timestamptz at time zone coalesce(z.name, 'UTC')) as local
      from users u left join pg_timezone_names z on z.name = u.timezone
      where u.deactivated_at is null and not u.bot
    )
    select l.id as "userId", t.id as "taskId", t.space_id as "spaceId",
      t.project_id as "projectId", k.kind, k.day::text as mark
    from l
    join task_assignees a on a.user_id = l.id
    join tasks t on t.id = a.task_id and t.archived_at is null
    join statuses s on s.id = t.status_id and s.category not in ('done', 'cancelled')
    join space_members m on m.space_id = t.space_id and m.user_id = l.id
    cross join lateral (values ('due_today', t.due_date), ('start_today', t.start_date)) k(kind, day)
    where extract(hour from l.local) = 9 and k.day = l.local::date
      and not exists (select 1 from notifications n where n.user_id = l.id and n.task_id = t.id
        and n.kind = k.kind and n.created_at > ${at}::timestamptz - interval '20 hours')
  `);
  // marks outlive every firing window (20 h for the daily ones, LATE_MIN for the timed)
  await db.execute(sql`delete from due_reminders where created_at < now() - interval '2 days'`);
  return notifyRows(db, systemUserId, rows, at);
}

async function notifyRows(
  db: Db,
  systemUserId: string,
  rows: {
    userId: string;
    taskId: string;
    spaceId: string;
    projectId: string;
    kind: Kind;
    mark: string;
  }[],
  at: string,
): Promise<string[]> {
  if (!rows.length) return [];
  return db.transaction(async (q) => {
    const tx = ServerTx.asSystem(q, { userId: systemUserId });
    const ids: string[] = [];
    for (const r of rows) {
      if (!(await projectAccess(q, r.userId, r.projectId))) continue; // PJ-11: custom project access
      // once per firing, even if the user deleted the notification
      const sent = await q.execute(
        sql`insert into due_reminders (user_id, task_id, kind, mark) values (${r.userId}, ${r.taskId}, ${r.kind}, ${r.mark})
          on conflict do nothing returning 1`,
      );
      if (!sent.rows.length) continue;
      const id = uuidv7();
      await tx.put('notifications', {
        id,
        userId: r.userId,
        spaceId: r.spaceId,
        kind: r.kind,
        taskId: r.taskId,
        url: null,
        body: null,
        commentId: null,
        changes: null,
        actorId: systemUserId,
        readAt: null,
        createdAt: at,
      });
      ids.push(id);
    }
    await tx.finish();
    return ids;
  });
}

export const DUE_TIME_QUEUE = 'core.due.time';
export const DUE_TIME_CRON = '* * * * *';
/** a missed run (downtime) is made up within this window, later — not worth waking anyone */
const LATE_MIN = 10;
/** default "remind before", minutes, when the task has dueTime and dueRemindMin is empty */
export const DEFAULT_REMIND_MIN = 10;

/**
 * Moment of the "due_soon" / "due_now" firing: dueDate+dueTime in the user's zone (unknown — UTC),
 * soon = due − remindMin (null — 10; 0 — no "soon", only "now"). Mirrors the SQL of remindDueTime.
 */
export function dueFireAt(
  dueDate: string,
  dueTime: string,
  remindMin: number | null,
  timeZone = 'UTC',
): { soon: Date | null; now: Date } {
  const wall = Date.parse(`${dueDate}T${dueTime}:00Z`);
  // zone offset at that instant (a second pass covers DST edges)
  const off = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!) - t;
  };
  let t = wall - off(wall);
  t = wall - off(t);
  const n = remindMin ?? DEFAULT_REMIND_MIN;
  return { now: new Date(t), soon: n > 0 ? new Date(t - n * 60000) : null };
}

/**
 * Timed due dates: "due_soon" at dueAt − N min and "due_now" at dueAt, to the assignees of open,
 * not archived tasks. Idempotent by the notifications themselves: no notification of the kind
 * created since the firing moment ⇒ send (a moved due time / changed N moves the moment, so it
 * fires again). Runs every minute; returns ids of new notifications (for push).
 */
export async function remindDueTime(
  db: Db,
  systemUserId: string,
  now = new Date(),
): Promise<string[]> {
  const at = now.toISOString();
  const { rows } = await db.execute<{
    userId: string;
    taskId: string;
    spaceId: string;
    projectId: string;
    kind: Kind;
    mark: string;
  }>(sql`
    with l as (
      select u.id, coalesce(z.name, 'UTC') as zone
      from users u left join pg_timezone_names z on z.name = u.timezone
      where u.deactivated_at is null and not u.bot
    ), x as (
      select l.id as uid, t.id as tid, t.space_id, t.project_id,
        (t.due_date + t.due_time::time) at time zone l.zone as due_at,
        coalesce(t.due_remind_min, ${DEFAULT_REMIND_MIN}) as n
      from l
      join task_assignees a on a.user_id = l.id
      join tasks t on t.id = a.task_id and t.archived_at is null
        and t.due_date is not null and t.due_time is not null
      join statuses s on s.id = t.status_id and s.category not in ('done', 'cancelled')
      join space_members m on m.space_id = t.space_id and m.user_id = l.id
    )
    select x.uid as "userId", x.tid as "taskId", x.space_id as "spaceId",
      x.project_id as "projectId", k.kind, k.fire::text as mark
    from x
    cross join lateral (values
      ('due_soon', x.due_at - x.n * interval '1 minute', x.n > 0),
      ('due_now', x.due_at, true)
    ) k(kind, fire, on_)
    where k.on_ and ${at}::timestamptz >= k.fire
      and ${at}::timestamptz < k.fire + ${LATE_MIN} * interval '1 minute'
      and (k.kind = 'due_now' or ${at}::timestamptz < x.due_at)
      and not exists (select 1 from notifications n where n.user_id = x.uid and n.task_id = x.tid
        and n.kind = k.kind and n.created_at >= k.fire)
  `);
  return notifyRows(db, systemUserId, rows, at);
}
