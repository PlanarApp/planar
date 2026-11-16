import { and, asc, eq, getTableColumns, isNull, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { generateKeyBetween } from 'fractional-indexing';
import { HttpError } from '../../auth/errors.js';
import { tableOf, toWire } from '../../sync/rows.js';
import type { ExtDeps } from './types.js';

const isUuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} не найден`);

const cols = (entity: string) => getTableColumns(tableOf(entity)) as Record<string, PgColumn>;

/** raw row of a module entity by id, or undefined */
export async function rawRow(d: ExtDeps, entity: string, id: string) {
  if (!isUuid(id)) return undefined;
  const [r] = await d.db
    .select()
    .from(tableOf(entity))
    .where(eq(cols(entity).id!, id));
  return r as Record<string, unknown> | undefined;
}

export async function wireRow(d: ExtDeps, entity: string, id: string) {
  return toWire(entity, (await rawRow(d, entity, id))!);
}

export async function wireRows(d: ExtDeps, entity: string, where: SQL, order: PgColumn[]) {
  const rows = await d.db
    .select()
    .from(tableOf(entity))
    .where(where)
    .orderBy(...order);
  return rows.map((r) => toWire(entity, r as Record<string, unknown>));
}

/** a cycle / milestone of a project the user sees, with the module on there; else 404 */
export async function projectRowOf(
  d: ExtDeps,
  userId: string,
  entity: string,
  module: string,
  id: string,
  what: string,
) {
  const r = await rawRow(d, entity, id);
  if (!r) throw notFound(what);
  const pid = r.projectId as string;
  await d.visibleProject(userId, pid).catch(() => {
    throw notFound(what);
  });
  await d.moduleOn(userId, module, pid);
  return r;
}

/** a goal / key result of a space where the user is a member; else 404 */
export async function spaceRowOf(
  d: ExtDeps,
  userId: string,
  entity: string,
  id: string,
  what: string,
) {
  const r = await rawRow(d, entity, id);
  if (!r) throw notFound(what);
  await visibleSpaceOf(d, userId, r.spaceId as string, what);
  return r;
}

export async function visibleSpaceOf(d: ExtDeps, userId: string, spaceId: string, what: string) {
  const c = cols('spaceMembers');
  const [m] = isUuid(spaceId)
    ? await d.db
        .select({ id: c.id! })
        .from(tableOf('spaceMembers'))
        .where(and(eq(c.spaceId!, spaceId), eq(c.userId!, userId)))
    : [];
  if (!m) throw notFound(what);
}

export async function goalsOf(d: ExtDeps, spaceId: string, archived: boolean) {
  const g = cols('goalsGoals');
  const goals = await wireRows(
    d,
    'goalsGoals',
    archived ? eq(g.spaceId!, spaceId) : and(eq(g.spaceId!, spaceId), isNull(g.archivedAt!))!,
    [g.rank!],
  );
  const k = cols('goalsKeyResults');
  const krs = await wireRows(d, 'goalsKeyResults', eq(k.spaceId!, spaceId), [k.rank!]);
  return goals.map((x) => ({ ...x, keyResults: krs.filter((r) => r.goalId === x.id) }));
}

export async function lastRank(d: ExtDeps, entity: string, where: SQL) {
  const c = cols(entity);
  const rows = await d.db
    .select({ rank: c.rank! })
    .from(tableOf(entity))
    .where(where)
    .orderBy(asc(c.rank!));
  return generateKeyBetween((rows.at(-1)?.rank as string | undefined) ?? null, null);
}

export { cols };
