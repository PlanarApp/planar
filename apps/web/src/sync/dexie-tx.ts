import type { Table } from 'dexie';
import {
  ENTITIES,
  MutatorError,
  entitySchemas,
  type EntityName,
  type Row,
  type Tx,
} from './shared';
import type { PlanarDB, Undo } from './db';

function check<E extends EntityName>(entity: E, row: unknown): Row<E> {
  const r = entitySchemas[entity].safeParse(row);
  if (!r.success) throw new MutatorError('invalid_args', `${entity}: ${r.error.message}`);
  return r.data as Row<E>;
}

/** Tx над Dexie; вызывать внутри транзакции db.transaction(). С undo — запоминает прообразы строк. */
export class DexieTx implements Tx {
  private seen = new Set<string>();
  constructor(
    private db: PlanarDB,
    private undo?: Undo[],
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
  }

  async del<E extends EntityName>(entity: E, id: string): Promise<void> {
    await this.note(entity, id);
    await this.table(entity).delete(id);
  }

  async scan<E extends EntityName>(
    entity: E,
    opts?: { index: string; eq: unknown },
  ): Promise<Row<E>[]> {
    const t = this.table(entity);
    if (!opts) return t.toArray();
    const meta = (ENTITIES as Record<string, { indexes: string[] }>)[entity];
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
export async function applyUndo(db: PlanarDB, undo: Undo[]): Promise<void> {
  for (let i = undo.length - 1; i >= 0; i--) {
    const u = undo[i];
    if (u.row) await db.table(u.entity).put(u.row);
    else await db.table(u.entity).delete(u.id);
  }
}
