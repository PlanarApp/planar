import {
  ENTITIES,
  MutatorError,
  entitySchemas,
  type EntityName,
  type Row,
  type Tx,
} from '../contract/index.js';

/** In-memory Tx: the same semantics as the server one, without permissions, changes and activity. */
export class MemoryTx implements Tx {
  private store = new Map<string, Map<string, Record<string, unknown>>>();

  private table(entity: string) {
    let t = this.store.get(entity);
    if (!t) this.store.set(entity, (t = new Map()));
    return t;
  }

  private validate(entity: EntityName, row: unknown): Record<string, unknown> {
    const r = entitySchemas[entity].safeParse(row);
    if (!r.success) throw new MutatorError('invalid_args', `${entity}: ${r.error.message}`);
    return structuredClone(r.data) as Record<string, unknown>;
  }

  async get<E extends EntityName>(entity: E, id: string): Promise<Row<E> | undefined> {
    const r = this.table(entity).get(id);
    return r && (structuredClone(r) as Row<E>);
  }

  async put<E extends EntityName>(entity: E, row: Row<E>): Promise<void> {
    const v = this.validate(entity, row);
    this.table(entity).set(v.id as string, v);
  }

  async patch<E extends EntityName>(
    entity: E,
    id: string,
    partial: Partial<Row<E>>,
  ): Promise<void> {
    const cur = this.table(entity).get(id);
    if (!cur) throw new MutatorError('not_found', `${entity} ${id}`);
    const defined = Object.fromEntries(Object.entries(partial).filter(([, v]) => v !== undefined));
    this.table(entity).set(id, this.validate(entity, { ...cur, ...defined }));
  }

  async del<E extends EntityName>(entity: E, id: string): Promise<void> {
    this.table(entity).delete(id);
  }

  async scan<E extends EntityName>(
    entity: E,
    opts?: { index: string; eq: unknown },
  ): Promise<Row<E>[]> {
    if (opts && !(ENTITIES[entity].indexes as string[]).includes(opts.index))
      throw new Error(`${entity}: нет индекса ${opts.index}`);
    const rows = [...this.table(entity).values()].filter((r) => !opts || r[opts.index] === opts.eq);
    return structuredClone(rows) as Row<E>[];
  }
}
