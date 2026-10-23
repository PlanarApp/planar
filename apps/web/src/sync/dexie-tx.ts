import type { Table } from 'dexie';
import {
  ENTITIES,
  MutatorError,
  entitySchemas,
  type EntityName,
  type Row,
  type Tx,
} from '@planar/shared';
import { moduleEntities } from '../modules/shared';
import type { PlanarDB, ReplicaChange, Undo } from './db';

function check<E extends EntityName>(entity: E, row: unknown): Row<E> {
  const schema = entitySchemas[entity] ?? moduleEntities[entity]?.schema;
  if (!schema) throw new MutatorError('invalid_args', `${entity}: неизвестная сущность`);
  const r = schema.safeParse(row);
  if (!r.success) throw new MutatorError('invalid_args', `${entity}: ${r.error.message}`);
  return r.data as Row<E>;
}

/** Tx над Dexie; вызывать внутри транзакции db.transaction(). С undo — запоминает прообразы строк. */
export class DexieTx implements Tx {
  private seen = new Set<string>();
  constructor(
    private db: PlanarDB,
    private undo?: Undo[],
    /** сюда пишутся изменённые строки (для onReplicaChange) */
    private changes?: ReplicaChange[],
  ) {}

  private table(entity: string): Table {
    return this.db.table(entity);
  }

  private async note(entity: string, id: string) {
    if (!this.undo || this.seen.has(entity + '/' + id)) return;
    this.seen.add(entity + '/' + id);
    this.undo.push({ entity, id, row: (await this.table(entity).get(id)) ?? null });
  }

  async get<E extends EntityName>(entity: E, id: string): Promise<Row<E> | undefined> {
    return this.table(entity).get(id);
  }

  async put<E extends EntityName>(entity: E, row: Row<E>): Promise<void> {
    const data = check(entity, row);
    await this.note(entity, data.id as string);
    await this.table(entity).put(data);
    this.changes?.push({ entity, id: data.id as string, row: data });
  }

  async patch<E extends EntityName>(
    entity: E,
    id: string,
    partial: Partial<Row<E>>,
  ): Promise<void> {
    const cur = await this.table(entity).get(id);
    if (!cur) throw new MutatorError('not_found', `${entity} ${id}`);
    const defined = Object.fromEntries(Object.entries(partial).filter(([, v]) => v !== undefined));
    const data = check(entity, { ...cur, ...defined });
    await this.note(entity, id);
    await this.table(entity).put(data);
    this.changes?.push({ entity, id, row: data });
  }

  async del<E extends EntityName>(entity: E, id: string): Promise<void> {
    await this.note(entity, id);
    await this.table(entity).delete(id);
    this.changes?.push({ entity, id, row: null });
  }

  async scan<E extends EntityName>(
    entity: E,
    opts?: { index: string; eq: unknown },
  ): Promise<Row<E>[]> {
    const t = this.table(entity);
    if (!opts) return t.toArray();
    const meta =
      (ENTITIES as Record<string, { indexes: string[] }>)[entity] ?? moduleEntities[entity]?.meta;
    if (!meta?.indexes.includes(opts.index)) {
      throw new Error(`scan: индекс ${opts.index} не объявлен у ${entity}`);
    }
    // shortcut: null/undefined не хранятся в индексе IndexedDB — полный просмотр таблицы
    if (opts.eq == null) return t.filter((r) => (r[opts.index] ?? null) === null).toArray();
    return t
      .where(opts.index)
      .equals(opts.eq as string)
      .toArray();
  }
}

/** Откат записей по прообразам (в обратном порядке). */
export async function applyUndo(
  db: PlanarDB,
  undo: Undo[],
  changes?: ReplicaChange[],
): Promise<void> {
  for (let i = undo.length - 1; i >= 0; i--) {
    const u = undo[i];
    if (u.row) await db.table(u.entity).put(u.row);
    else await db.table(u.entity).delete(u.id);
    changes?.push({ entity: u.entity, id: u.id, row: u.row });
  }
}
