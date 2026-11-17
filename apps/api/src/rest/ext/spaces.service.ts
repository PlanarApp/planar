import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import { uuidv7 } from '@planar/shared';
import { HttpError } from '../../auth/errors.js';
import * as s from '../../db/schema.js';
import { toWire } from '../../sync/rows.js';
import type { ExtDeps } from './types.js';

const NOT_FOUND = (what: string) => new HttpError(404, 'not_found', `${what} не найден`);
const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** 404 unless the user is a member of the space (a foreign space is not visible) */
export async function visibleSpace(d: ExtDeps, userId: string, id: string) {
  const [m] = isUuid(id)
    ? await d.db
        .select({ id: s.spaceMembers.id })
        .from(s.spaceMembers)
        .where(and(eq(s.spaceMembers.spaceId, id), eq(s.spaceMembers.userId, userId)))
    : [];
  if (!m) throw NOT_FOUND('Пространство');
  return id;
}

export async function spaceRow(d: ExtDeps, id: string) {
  const [r] = await d.db.select().from(s.spaces).where(eq(s.spaces.id, id));
  return toWire('spaces', r!);
}

export async function projectRow(d: ExtDeps, id: string) {
  const [r] = await d.db.select().from(s.projects).where(eq(s.projects.id, id));
  return toWire('projects', r!);
}

export async function lastSpaceRank(d: ExtDeps) {
  const [l] = await d.db
    .select({ rank: s.spaces.rank })
    .from(s.spaces)
    .orderBy(desc(s.spaces.rank))
    .limit(1);
  return generateKeyBetween(l?.rank ?? null, null);
}

export async function lastProjectRank(d: ExtDeps, spaceId: string) {
  const [l] = await d.db
    .select({ rank: s.projects.rank })
    .from(s.projects)
    .where(eq(s.projects.spaceId, spaceId))
    .orderBy(desc(s.projects.rank))
    .limit(1);
  return generateKeyBetween(l?.rank ?? null, null);
}

/** every status and label of a project as copy pairs with fresh ids */
export async function copyPairs(d: ExtDeps, projectId: string) {
  const pairs = async (t: typeof s.statuses | typeof s.labels) =>
    (await d.db.select({ id: t.id }).from(t).where(eq(t.projectId, projectId))).map((r) => ({
      id: uuidv7(),
      fromId: r.id,
    }));
  return { statuses: await pairs(s.statuses), labels: await pairs(s.labels) };
}

/** space members with the user's name; the id is the row id of space_members */
export async function spaceMembers(d: ExtDeps, spaceId: string) {
  return d.db
    .select({
      id: s.spaceMembers.id,
      userId: s.users.id,
      login: s.users.login,
      name: s.users.name,
      role: s.spaceMembers.role,
    })
    .from(s.spaceMembers)
    .innerJoin(s.users, eq(s.users.id, s.spaceMembers.userId))
    .where(and(eq(s.spaceMembers.spaceId, spaceId), isNull(s.users.deactivatedAt)))
    .orderBy(asc(s.users.name), asc(s.users.id));
}

/** who has access to the project and in what role (PJ-11: project_role), plus the members mode */
export async function projectMembers(d: ExtDeps, projectId: string) {
  const [p] = await d.db
    .select({ spaceId: s.projects.spaceId, mode: s.projects.membersMode })
    .from(s.projects)
    .where(eq(s.projects.id, projectId));
  const rows = await d.db
    .select({
      userId: s.users.id,
      login: s.users.login,
      name: s.users.name,
      role: sql<string | null>`project_role(${s.users.id}, ${projectId}::uuid)`,
    })
    .from(s.users)
    .innerJoin(s.spaceMembers, eq(s.spaceMembers.userId, s.users.id))
    .where(and(eq(s.spaceMembers.spaceId, p!.spaceId), isNull(s.users.deactivatedAt)))
    .orderBy(asc(s.users.name), asc(s.users.id));
  return { membersMode: p!.mode, members: rows.filter((r) => r.role) };
}

/** the space_members row of (space, user) */
export async function spaceMemberRow(d: ExtDeps, spaceId: string, userId: string) {
  const [m] = await d.db
    .select({ id: s.spaceMembers.id })
    .from(s.spaceMembers)
    .where(and(eq(s.spaceMembers.spaceId, spaceId), eq(s.spaceMembers.userId, userId)));
  if (!m) throw NOT_FOUND('Участник');
  return m.id;
}

/** the project_members row of (project, user) */
export async function projectMemberRow(d: ExtDeps, projectId: string, userId: string) {
  const [m] = await d.db
    .select({ id: s.projectMembers.id })
    .from(s.projectMembers)
    .where(and(eq(s.projectMembers.projectId, projectId), eq(s.projectMembers.userId, userId)));
  if (!m) throw NOT_FOUND('Участник проекта');
  return m.id;
}
