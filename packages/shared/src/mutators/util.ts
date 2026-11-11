import { z } from 'zod';
import {
  MutatorError,
  entitySchemas,
  type EntityName,
  type MutatorCtx,
  type Row,
  type Tx,
} from '../contract/index.js';

export const uuid = z.uuid();
export const rank = z.string().min(1);
export const name = z.string().min(1).max(100);
export const color = z.string();
export const doc = entitySchemas.comments.shape.body;
export const date = z.iso.date();
export const record = z.record(z.string(), z.unknown());

export const bad = (msg: string) => new MutatorError('invalid_args', msg);

export async function need<E extends EntityName>(tx: Tx, entity: E, id: string): Promise<Row<E>> {
  const r = await tx.get(entity, id);
  if (!r) throw new MutatorError('not_found', `${entity} ${id}`);
  return r;
}

/** Only the passed fields (without id) + updatedAt. */
export function changes<E extends EntityName>(
  _entity: E,
  args: { id?: string },
  ctx: MutatorCtx,
): Partial<Row<E>> {
  const rest: Record<string, unknown> = { ...args };
  delete rest.id;
  return {
    ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
    updatedAt: ctx.now,
  } as unknown as Partial<Row<E>>;
}

/** Delete all entity rows with index = eq. */
export async function delWhere(tx: Tx, entity: EntityName, index: string, eq: unknown) {
  for (const r of await tx.scan(entity, { index, eq })) await tx.del(entity, r.id);
}

/** completedAt by status category: done/cancelled — the previous ?? now, otherwise null. */
export function completedAt(category: string, prev: string | null, ctx: MutatorCtx) {
  return category === 'done' || category === 'cancelled' ? (prev ?? ctx.now) : null;
}

/**
 * Admin of the project (projectId null — of the space), as the SQL rule project_role: instance admin,
 * space admin, or project admin of a `custom` project. The system user (deactivated) passes too — archive purge.
 */
export async function isProjectAdmin(
  tx: Tx,
  spaceId: string,
  projectId: string | null,
  userId: string,
): Promise<boolean> {
  const u = await tx.get('users', userId);
  if (u && (u.deactivatedAt || u.role === 'owner' || u.role === 'admin')) return true;
  const sm = (await tx.scan('spaceMembers', { index: 'spaceId', eq: spaceId })).find(
    (m) => m.userId === userId,
  );
  if (sm?.role === 'admin') return true;
  if (!sm || sm.role === 'guest' || !projectId) return false;
  if ((await tx.get('projects', projectId))?.membersMode !== 'custom') return false;
  return (await tx.scan('projectMembers', { index: 'projectId', eq: projectId })).some(
    (m) => m.userId === userId && m.role === 'admin',
  );
}

/** Admin-only action (restore, delete of archived rows). */
export async function needProjectAdmin(
  tx: Tx,
  spaceId: string,
  projectId: string | null,
  userId: string,
) {
  if (!(await isProjectAdmin(tx, spaceId, projectId, userId)))
    throw new MutatorError('forbidden', 'нужна роль admin проекта');
}
