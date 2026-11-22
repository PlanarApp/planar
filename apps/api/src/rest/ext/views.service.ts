import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import { HttpError } from '../../auth/errors.js';
import * as s from '../../db/schema.js';
import { hiddenProjectIds } from '../../sync/project-access.js';
import { toWire } from '../../sync/rows.js';
import { toV1Tasks } from '../v1-tasks.js';
import type { ExtDeps } from './types.js';

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} не найден`);

export async function mySpaces(d: ExtDeps, userId: string) {
  const rows = await d.db
    .select({ id: s.spaceMembers.spaceId })
    .from(s.spaceMembers)
    .where(eq(s.spaceMembers.userId, userId));
  return rows.map((r) => r.id);
}

export async function requireSpace(d: ExtDeps, userId: string, spaceId: string) {
  if (!(await mySpaces(d, userId)).includes(spaceId)) throw notFound('Пространство');
}

/** a node of a view: w | s:<id> | p:<id>[:me-…]; a project node must be visible and lie in the space */
export async function requireNode(d: ExtDeps, userId: string, spaceId: string, node: string) {
  const m = /^p:([0-9a-f-]{36})/.exec(node);
  if (m) {
    const pid = await d.visibleProject(userId, m[1]!);
    const [p] = await d.db
      .select({ spaceId: s.projects.spaceId })
      .from(s.projects)
      .where(eq(s.projects.id, pid));
    if (p?.spaceId !== spaceId) throw notFound('Проект');
  } else if (/^s:/.test(node) && node.slice(2, 38) !== spaceId) throw notFound('Пространство');
}

/** a view of the user's spaces: shared or own personal; otherwise 404 */
export async function viewRow(d: ExtDeps, userId: string, id: string) {
  const [v] = await d.db
    .select()
    .from(s.savedViews)
    .where(
      and(
        eq(s.savedViews.id, id),
        inArray(s.savedViews.spaceId, await mySpaces(d, userId)),
        or(isNull(s.savedViews.userId), eq(s.savedViews.userId, userId)),
      ),
    );
  if (!v) throw notFound('Вид');
  return v;
}

export async function listViews(d: ExtDeps, userId: string, spaceId?: string, node?: string) {
  const my = await mySpaces(d, userId);
  if (spaceId && !my.includes(spaceId)) throw notFound('Пространство');
  const rows = await d.db
    .select()
    .from(s.savedViews)
    .where(
      and(
        inArray(s.savedViews.spaceId, spaceId ? [spaceId] : my),
        or(isNull(s.savedViews.userId), eq(s.savedViews.userId, userId)),
        node === undefined ? undefined : eq(s.savedViews.node, node),
      ),
    )
    .orderBy(asc(s.savedViews.rank), asc(s.savedViews.id));
  return rows.map((r) => toWire('savedViews', r));
}

export async function nextViewRank(d: ExtDeps, spaceId: string) {
  const [last] = await d.db
    .select({ rank: s.savedViews.rank })
    .from(s.savedViews)
    .where(eq(s.savedViews.spaceId, spaceId))
    .orderBy(desc(s.savedViews.rank))
    .limit(1);
  return generateKeyBetween(last?.rank ?? null, null);
}

export const wireView = async (d: ExtDeps, id: string) => {
  const [v] = await d.db.select().from(s.savedViews).where(eq(s.savedViews.id, id));
  return toWire('savedViews', v!);
};

export async function nextFavoriteRank(d: ExtDeps, userId: string) {
  const [last] = await d.db
    .select({ rank: s.favorites.rank })
    .from(s.favorites)
    .where(eq(s.favorites.userId, userId))
    .orderBy(desc(s.favorites.rank))
    .limit(1);
  return generateKeyBetween(last?.rank ?? null, null);
}

export async function listFavorites(d: ExtDeps, userId: string) {
  const rows = await d.db
    .select()
    .from(s.favorites)
    .where(eq(s.favorites.userId, userId))
    .orderBy(asc(s.favorites.rank), asc(s.favorites.id));
  return rows.map((r) => toWire('favorites', r));
}

export async function ownFavorite(d: ExtDeps, userId: string, id: string) {
  const [f] = await d.db
    .select()
    .from(s.favorites)
    .where(and(eq(s.favorites.id, id), eq(s.favorites.userId, userId)));
  if (!f) throw notFound('Избранное');
  return f;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** the entity of every favourite kind must be visible to the user, else 404 (kinds of entities.favorites) */
export async function requireFavoriteRef(d: ExtDeps, userId: string, kind: string, refId: string) {
  if (kind === 'workspace') {
    if (refId !== 'w') throw notFound('Рабочее пространство');
    return;
  }
  if (!UUID.test(refId)) throw notFound('Объект');
  if (kind === 'project') await d.visibleProject(userId, refId);
  else if (kind === 'space') await requireSpace(d, userId, refId);
  else if (kind === 'task') await requireTask(d, userId, refId);
  else if (kind === 'doc') {
    // a page of the user's spaces outside hidden projects (rule: SQL function project_role)
    const r = await d.db.execute(sql`select 1 from docs_pages p where p.id = ${refId}::uuid
      and exists (select 1 from space_members m where m.space_id = p.space_id and m.user_id = ${userId}::uuid)
      and (p.project_id is null or project_role(${userId}::uuid, p.project_id) is not null)`);
    if (!r.rows.length) throw notFound('Документ');
  } else if (kind === 'chat') {
    // as canSee of the chat module: a space member (project not hidden) or a member of a dialog
    const r = await d.db.execute(sql`select 1 from chat_channels c where c.id = ${refId}::uuid and (
      (c.space_id is not null
        and exists (select 1 from space_members m where m.space_id = c.space_id and m.user_id = ${userId}::uuid)
        and (c.project_id is null or project_role(${userId}::uuid, c.project_id) is not null))
      or (c.space_id is null
        and exists (select 1 from chat_members m where m.channel_id = c.id and m.user_id = ${userId}::uuid)))`);
    if (!r.rows.length) throw notFound('Чат');
  }
}

/**
 * «My day» (PLNRAPP-709): not archived tasks of visible projects where the user is an assignee, with a due date —
 * on `date` or any; by dueDate, then priority (0 «none» last), then key
 */
export async function listDay(d: ExtDeps, userId: string, date?: string) {
  const hidden = await hiddenProjectIds(d.db, userId);
  const rows = await d.db
    .select({ t: s.tasks })
    .from(s.tasks)
    .innerJoin(
      s.taskAssignees,
      and(eq(s.taskAssignees.taskId, s.tasks.id), eq(s.taskAssignees.userId, userId)),
    )
    .innerJoin(s.projects, eq(s.projects.id, s.tasks.projectId))
    .where(
      and(
        inArray(s.tasks.spaceId, await mySpaces(d, userId)),
        isNull(s.tasks.archivedAt),
        date ? eq(s.tasks.dueDate, date) : isNotNull(s.tasks.dueDate),
        hidden.length ? notInArray(s.tasks.projectId, hidden) : undefined,
      ),
    )
    .orderBy(
      asc(s.tasks.dueDate),
      sql`case when ${s.tasks.priority} = 0 then 5 else ${s.tasks.priority} end`,
      asc(s.projects.key),
      asc(s.tasks.number),
      asc(s.tasks.id),
    );
  return toV1Tasks(
    d.db,
    rows.map((r) => r.t),
    userId,
  );
}

/** a task of the user's spaces outside hidden projects, else 404 */
export async function requireTask(d: ExtDeps, userId: string, id: string) {
  const [t] = await d.db
    .select({ projectId: s.tasks.projectId })
    .from(s.tasks)
    .where(and(eq(s.tasks.id, id), inArray(s.tasks.spaceId, await mySpaces(d, userId))));
  if (!t || (await hiddenProjectIds(d.db, userId)).includes(t.projectId)) throw notFound('Задача');
}

export async function listNotifications(
  d: ExtDeps,
  userId: string,
  unread: boolean,
  limit: number,
) {
  const rows = await d.db
    .select()
    .from(s.notifications)
    .where(
      and(eq(s.notifications.userId, userId), unread ? isNull(s.notifications.readAt) : undefined),
    )
    .orderBy(desc(s.notifications.createdAt), desc(s.notifications.id))
    .limit(limit);
  return rows.map((r) => toWire('notifications', r));
}

/** every id must be the user's own notification, else 404 (a foreign one is not revealed) */
export async function requireOwnNotifications(d: ExtDeps, userId: string, ids: string[]) {
  const rows = await d.db
    .select({ id: s.notifications.id })
    .from(s.notifications)
    .where(and(inArray(s.notifications.id, ids), eq(s.notifications.userId, userId)));
  if (rows.length !== new Set(ids).size) throw notFound('Уведомление');
}
