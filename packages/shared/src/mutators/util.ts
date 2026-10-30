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
