import type { z } from 'zod';
import type { entitySchemas } from './entities.js';

export type EntityName = keyof typeof entitySchemas;
export type Row<E extends EntityName> = z.output<(typeof entitySchemas)[E]>;

export interface MutatorCtx {
  userId: string;
  /** ISO ts */
  now: string;
  server: boolean;
}

export interface Tx {
  get<E extends EntityName>(entity: E, id: string): Promise<Row<E> | undefined>;
  /** вставка или полная замена */
  put<E extends EntityName>(entity: E, row: Row<E>): Promise<void>;
  /** нет строки → MutatorError('not_found') */
  patch<E extends EntityName>(entity: E, id: string, partial: Partial<Row<E>>): Promise<void>;
  /** нет строки → ничего */
  del<E extends EntityName>(entity: E, id: string): Promise<void>;
  /** порядок не гарантирован */
  scan<E extends EntityName>(entity: E, opts?: { index: string; eq: unknown }): Promise<Row<E>[]>;
}

export interface MutatorDef<A extends z.ZodType = z.ZodType> {
  name: string;
  args: A;
  run(tx: Tx, args: z.output<A>, ctx: MutatorCtx): Promise<void>;
}

/** Возвращает def как есть; нужна для вывода типа args. */
export function defineMutator<A extends z.ZodType>(def: MutatorDef<A>): MutatorDef<A> {
  return def;
}

export function createRegistry(defs: MutatorDef[]): Map<string, MutatorDef> {
  const map = new Map<string, MutatorDef>();
  for (const d of defs) {
    if (map.has(d.name)) throw new Error(`duplicate mutator: ${d.name}`);
    map.set(d.name, d);
  }
  return map;
}

export type MutationErrorCode = 'invalid_args' | 'forbidden' | 'not_found' | 'conflict';

export class MutatorError extends Error {
  constructor(
    public code: MutationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MutatorError';
  }
}
