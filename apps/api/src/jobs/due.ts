import { sql } from 'drizzle-orm';
import { uuidv7 } from '@planar/shared';
import type { Db } from '../db/index.js';
import { projectAccess } from '../sync/project-access.js';
import { ServerTx } from '../sync/server-tx.js';

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
    kind: 'due_today' | 'start_today';
  }>(sql`
    with l as (
      select u.id, (${at}::timestamptz at time zone coalesce(z.name, 'UTC')) as local
      from users u left join pg_timezone_names z on z.name = u.timezone
      where u.deactivated_at is null and not u.bot
    )
    select l.id as "userId", t.id as "taskId", t.space_id as "spaceId",
      t.project_id as "projectId", k.kind
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
  if (!rows.length) return [];
  return db.transaction(async (q) => {
    const tx = ServerTx.asSystem(q, { userId: systemUserId });
    const ids: string[] = [];
    for (const r of rows) {
      if (!(await projectAccess(q, r.userId, r.projectId))) continue; // PJ-11: custom project access
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
