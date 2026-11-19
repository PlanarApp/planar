import { sql } from 'drizzle-orm';

/**
 * PLNRAPP-576: recomputes the tasks counters of assigned comments (commentsAssigned, commentsResolved,
 * commentsOpenAssignees) of all tasks from `comments` — for rows written past ServerTx (demo seed).
 * Migration 0076 backfills them the same way.
 */
export const recountAssignedComments = sql`
  update tasks t set
    comments_assigned = coalesce(x.total, 0),
    comments_resolved = coalesce(x.resolved, 0),
    comments_open_assignees = coalesce(x.open, '{}')
  from tasks t0 left join (
    select task_id,
      count(*)::int as total,
      (count(*) filter (where resolved_at is not null))::int as resolved,
      array_agg(distinct assignee_id order by assignee_id) filter (where resolved_at is null) as open
    from comments where assignee_id is not null group by task_id
  ) x on x.task_id = t0.id
  where t.id = t0.id`;
