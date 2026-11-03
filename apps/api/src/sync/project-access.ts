import { eq, getTableColumns, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Db } from '../db/index.js';
import { tableOf } from './rows.js';

/** Db or transaction (the same shape as server-tx Q). */
type R = Pick<Db, 'select' | 'execute'>;
export type ProjectRole = 'admin' | 'member' | 'guest';

export const PROJECT_RANK: Record<string, number> = { guest: 1, member: 2, admin: 3 };

/**
 * PJ-11, the one rule of project access: the role of the user in the project, null — no access.
 * The rule itself is the SQL function `project_role` (migration 0034), also used by module SQL:
 * inherit — the role in the space; custom — the role in projectMembers; space and instance admins — admin.
 */
export async function projectAccess(
  q: R,
  userId: string,
  projectId: string,
): Promise<ProjectRole | null> {
  const r = await q.execute(sql`select project_role(${userId}::uuid, ${projectId}::uuid) as r`);
  return (r.rows[0]?.r as ProjectRole | null | undefined) ?? null;
}

/** Projects the user has no access to (only `custom` ones can be hidden). */
export async function hiddenProjectIds(q: R, userId: string): Promise<string[]> {
  const r = await q.execute(
    sql`select id from projects where members_mode = 'custom' and project_role(${userId}::uuid, id) is null`,
  );
  return r.rows.map((x) => x.id as string);
}

/**
 * How a row reaches its project: the first of these columns the entity has; the value is a project id
 * (`projectId`) or an id of the row of the entity named here, which is resolved further.
 * A new entity with such a reference is covered automatically; a new kind of reference must be added here
 * (the contract test fails otherwise).
 */
export const PROJECT_REFS: [column: string, target: string | null][] = [
  ['projectId', null],
  ['taskId', 'tasks'],
  ['commentId', 'comments'],
  ['channelId', 'chatChannels'],
  ['milestoneId', 'goalsMilestones'],
  ['pageId', 'docsPages'],
  ['ruleId', 'automationsRules'],
];

/** Entities whose own `id` is a project id (null) or the id of a row of another entity. */
export const SELF_REFS: Record<string, string | null> = {
  projects: null,
  gitlabProjectSettings: null,
  docsLocks: 'docsPages',
};

/** The reference of the entity to its project; null — the entity is not tied to a project. */
export function projectRefOf(entity: string): { column: string; target: string | null } | null {
  if (entity in SELF_REFS) return { column: 'id', target: SELF_REFS[entity]! };
  const c = getTableColumns(tableOf(entity));
  const ref = PROJECT_REFS.find(([col]) => col in c);
  return ref ? { column: ref[0], target: ref[1] } : null;
}

/** SQL of the project id of a row of the entity (its table must be in FROM); null — the entity has no project. */
export function projectIdSql(entity: string): SQL | null {
  const ref = projectRefOf(entity);
  if (!ref) return null;
  const c = getTableColumns(tableOf(entity)) as Record<string, PgColumn>;
  if (!ref.target) return sql`${c[ref.column]!}`;
  const inner = projectIdSql(ref.target)!;
  const tt = tableOf(ref.target);
  return sql`(select ${inner} from ${tt} where ${(getTableColumns(tt) as Record<string, PgColumn>).id!} = ${c[ref.column]!})`;
}

/** Where-condition: the row is not in a project hidden from the user (rows without a project pass). */
export function notHidden(entity: string, hidden: string[]): SQL | undefined {
  const e = hidden.length ? projectIdSql(entity) : null;
  return e ? or(isNull(e), notInArray(e, hidden)) : undefined;
}

/** Project of a wire row (as in the journal); null — not tied to a project. cache: `${entity}:${id}` -> project id. */
export async function projectOfWire(
  q: R,
  entity: string,
  row: Record<string, unknown>,
  cache: Map<string, string | null> = new Map(),
): Promise<string | null> {
  const ref = projectRefOf(entity);
  if (!ref) return null;
  const v = row[ref.column];
  if (typeof v !== 'string') return null;
  if (!ref.target) return v;
  const key = `${ref.target}:${v}`;
  if (!cache.has(key)) {
    const t = tableOf(ref.target);
    const [r] = (await q
      .select()
      .from(t)
      .where(eq((getTableColumns(t) as Record<string, PgColumn>).id!, v))
      .limit(1)) as Record<string, unknown>[];
    cache.set(key, r ? await projectOfWire(q, ref.target, r, cache) : null);
  }
  return cache.get(key) ?? null;
}
