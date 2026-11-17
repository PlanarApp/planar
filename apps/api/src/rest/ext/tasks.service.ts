import { desc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { HttpError } from '../../auth/errors.js';
import * as s from '../../db/schema.js';
import type { ExtDeps } from './types.js';

const notFound = (what: string) => new HttpError(404, 'not_found', `${what}: не найдено`);

/** task by uuid or key ABC-123; a foreign / hidden one is 404 (visibleProject checks space and project access) */
export async function findTask(d: ExtDeps, userId: string, ref: string) {
  let cond: SQL;
  const i = ref.lastIndexOf('-');
  if (z.uuid().safeParse(ref).success) cond = eq(s.tasks.id, ref);
  else if (i > 0 && /^\d+$/.test(ref.slice(i + 1)) && Number(ref.slice(i + 1)) < 2 ** 31)
    cond = sql`${s.tasks.number} = ${Number(ref.slice(i + 1))} and ${s.tasks.projectId} = (select id from ${s.projects} where ${s.projects.key} = ${ref.slice(0, i)})`;
  else throw notFound('Задача');
  const [row] = await d.db.select().from(s.tasks).where(cond);
  if (!row) throw notFound('Задача');
  await d.visibleProject(userId, row.projectId).catch(() => {
    throw notFound('Задача');
  });
  return row;
}

/** a comment / checklist item of a visible task */
export async function findOwned(
  d: ExtDeps,
  userId: string,
  kind: 'comment' | 'checklist',
  id: string,
) {
  const t = kind === 'comment' ? s.comments : s.checklistItems;
  const [row] = await d.db.select({ taskId: t.taskId }).from(t).where(eq(t.id, id));
  if (!row) throw notFound(kind === 'comment' ? 'Комментарий' : 'Пункт чек-листа');
  return findTask(d, userId, row.taskId);
}

export async function checklist(d: ExtDeps, taskId: string) {
  return d.db
    .select()
    .from(s.checklistItems)
    .where(eq(s.checklistItems.taskId, taskId))
    .orderBy(s.checklistItems.rank, s.checklistItems.id);
}

export async function lastRank(d: ExtDeps, taskId: string) {
  const [r] = await d.db
    .select({ rank: s.checklistItems.rank })
    .from(s.checklistItems)
    .where(eq(s.checklistItems.taskId, taskId))
    .orderBy(desc(s.checklistItems.rank))
    .limit(1);
  return r?.rank ?? null;
}

export async function activityOf(d: ExtDeps, taskId: string, limit: number) {
  return d.db
    .select()
    .from(s.activity)
    .where(eq(s.activity.taskId, taskId))
    .orderBy(desc(s.activity.createdAt), desc(s.activity.id))
    .limit(limit);
}
