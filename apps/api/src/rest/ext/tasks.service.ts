import { desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { generateNKeysBetween } from 'fractional-indexing';
import { z } from 'zod';
import { HttpError } from '../../auth/errors.js';
import * as s from '../../db/schema.js';
import { PROJECT_RANK, projectAccess } from '../../sync/project-access.js';
import { toV1Tasks } from '../v1-tasks.js';
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

/** PLNRAPP-292: a problem task of `move_tasks` — the ref as given, a code and a reason */
export interface MoveProblem {
  task: string;
  code: 'not_found' | 'duplicate' | 'forbidden' | 'other_project' | 'archived';
  message: string;
}

/** 404 of findTask → null; other errors go on */
const missing = (e: unknown) => {
  if (e instanceof HttpError) return null;
  throw e;
};

const byRank = (a: { rank: string; id: string }, b: { rank: string; id: string }) =>
  a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/**
 * Ranks for `n` tasks dropped into `column` (sorted, without the moved tasks) at index `at`:
 * the tasks go in a row between the neighbours. Repeated ranks (old data): the column tasks after
 * the drop point with a rank ≤ the upper neighbour get new ranks after the moved ones (`rerank`).
 */
export function dropRanks(
  column: { id: string; rank: string }[],
  at: number,
  n: number,
): { ranks: string[]; rerank: [id: string, rank: string][] } {
  const lo = column[at - 1]?.rank ?? null;
  let j = at;
  if (lo !== null) while (j < column.length && column[j]!.rank <= lo) j++;
  const keys = generateNKeysBetween(lo, column[j]?.rank ?? null, n + j - at);
  return {
    ranks: keys.slice(0, n),
    rerank: column.slice(at, j).map((t, k) => [t.id, keys[n + k]!]),
  };
}

/**
 * PLNRAPP-292: atomic group move. All checks first, every problem task listed (409 conflict,
 * details.tasks); then one transaction of task.update — all or none. Tasks keep the order of `refs`.
 */
export async function moveTasks(
  d: ExtDeps,
  userId: string,
  a: { taskIds: string[]; statusId: string; before?: string | null; index?: number },
  tokenId?: string,
) {
  if (a.before != null && a.index !== undefined)
    throw new HttpError(400, 'invalid_request', 'нужен один из before и index');
  const [status] = await d.db.select().from(s.statuses).where(eq(s.statuses.id, a.statusId));
  if (!status) throw notFound('Статус');
  await d.visibleProject(userId, status.projectId).catch(() => {
    throw notFound('Статус');
  });
  const problems: MoveProblem[] = [];
  const moved: (typeof s.tasks.$inferSelect)[] = [];
  const seen = new Set<string>();
  const access = new Map<string, boolean>();
  for (const ref of a.taskIds) {
    const t = await findTask(d, userId, ref).catch(missing);
    if (!t) {
      problems.push({ task: ref, code: 'not_found', message: 'задача не найдена' });
      continue;
    }
    if (seen.has(t.id)) {
      problems.push({ task: ref, code: 'duplicate', message: 'задача указана повторно' });
      continue;
    }
    seen.add(t.id);
    if (!access.has(t.projectId)) {
      const role = await projectAccess(d.db, userId, t.projectId);
      access.set(t.projectId, (PROJECT_RANK[role ?? ''] ?? 0) >= PROJECT_RANK.member!);
    }
    if (!access.get(t.projectId))
      problems.push({ task: ref, code: 'forbidden', message: 'нет прав на изменение задачи' });
    else if (t.projectId !== status.projectId)
      problems.push({ task: ref, code: 'other_project', message: 'статус другого проекта' });
    else if (t.archivedAt)
      problems.push({ task: ref, code: 'archived', message: 'задача в архиве' });
    moved.push(t);
  }
  if (problems.length)
    throw new HttpError(409, 'conflict', `Задачи не перенесены: проблемных ${problems.length}`, {
      tasks: problems,
    });
  const column = (
    await d.db
      .select({ id: s.tasks.id, rank: s.tasks.rank })
      .from(s.tasks)
      .where(sql`${s.tasks.statusId} = ${status.id} and ${s.tasks.archivedAt} is null`)
  ).sort(byRank);
  let at = column.length;
  if (a.before != null) {
    const b = await findTask(d, userId, a.before).catch(missing);
    const all = column.map((t) => t.id);
    let i = b ? all.indexOf(b.id) : -1;
    if (i < 0) throw new HttpError(400, 'invalid_request', 'before: задачи нет в целевом статусе');
    // the anchor is one of the moved tasks: drop before the next one that stays
    while (i < all.length && seen.has(all[i]!)) i++;
    at = all.slice(0, i).filter((id) => !seen.has(id)).length;
  } else if (a.index !== undefined) at = a.index;
  const rest = column.filter((t) => !seen.has(t.id));
  at = Math.min(at, rest.length);
  const { ranks, rerank } = dropRanks(rest, at, moved.length);
  await d.run(
    userId,
    [
      ...moved.map((t, k) => ({
        name: 'task.update',
        args: { id: t.id, statusId: status.id, rank: ranks[k] },
      })),
      ...rerank.map(([id, rank]) => ({ name: 'task.update', args: { id, rank } })),
    ],
    tokenId,
  );
  const rows = await d.db
    .select()
    .from(s.tasks)
    .where(inArray(s.tasks.id, [...seen]));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return toV1Tasks(
    d.db,
    moved.map((t) => byId.get(t.id)!),
  );
}
