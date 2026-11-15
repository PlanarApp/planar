import type { Table } from 'dexie';
import {
  ENTITIES,
  MutatorError,
  entitySchemas,
  type EntityName,
  type ModuleEntity,
  type Row,
  type Tx,
} from '@planar/shared';
import type { PlanarDB, ReplicaChange, Undo } from './db';
import { same } from './query';

const moduleEntities = new Map<string, ModuleEntity>();
/** Entities of installed modules: the client Tx checks and scans them the same way as core entities. */
export const registerModuleEntities = (e: Record<string, ModuleEntity>): void =>
  void Object.entries(e).forEach(([n, v]) => moduleEntities.set(n, v));

function check<E extends EntityName>(entity: E, row: unknown): Row<E> {
  const schema = moduleEntities.get(entity)?.schema ?? entitySchemas[entity];
  const r = schema.safeParse(row);
  if (!r.success) throw new MutatorError('invalid_args', `${entity}: ${r.error.message}`);
  return r.data as Row<E>;
}

type AnyRow = Record<string, unknown>;
/** Writes kept in memory over Dexie (`entity\0id` → row, null — deleted); see flushOverlay. */
export type Overlay = Map<string, AnyRow | null>;
export const overlayKey = (entity: string, id: string) => entity + '\0' + id;
const byId = (a: AnyRow, b: AnyRow) => (a.id! < b.id! ? -1 : a.id! > b.id! ? 1 : 0);

/**
 * Tx over Dexie; call inside db.transaction(). With undo — remembers row pre-images.
 * With overlay — reads through it and writes only to it, Dexie stays untouched.
 */
export class DexieTx implements Tx {
  private seen = new Set<string>();
  constructor(
    private db: PlanarDB,
    private undo?: Undo[],
    /** changed rows are written here (for onReplicaChange) */
    private changes?: ReplicaChange[],
    private overlay?: Overlay,
  ) {}

  private table(entity: string): Table {
    return this.db.table(entity);
  }

  private async read(entity: string, id: string): Promise<AnyRow | undefined> {
    const k = overlayKey(entity, id);
    // a copy, like Dexie: the mutator may edit the result
    if (this.overlay?.has(k)) return structuredClone(this.overlay.get(k)) ?? undefined;
    return this.table(entity).get(id);
  }

  private async write(entity: string, id: string, row: AnyRow | null) {
    if (this.overlay) this.overlay.set(overlayKey(entity, id), row);
    else if (row) await this.table(entity).put(row);
    else await this.table(entity).delete(id);
    this.changes?.push({ entity, id, row });
  }

  private async note(entity: string, id: string) {
    if (!this.undo || this.seen.has(entity + '/' + id)) return;
    this.seen.add(entity + '/' + id);
    this.undo.push({ entity, id, row: (await this.read(entity, id)) ?? null });
  }

  async get<E extends EntityName>(entity: E, id: string): Promise<Row<E> | undefined> {
    return (await this.read(entity, id)) as Row<E> | undefined;
  }

  async put<E extends EntityName>(entity: E, row: Row<E>): Promise<void> {
    const data = check(entity, row);
    await this.note(entity, data.id as string);
    await this.write(entity, data.id as string, data);
  }

  async patch<E extends EntityName>(
    entity: E,
    id: string,
    partial: Partial<Row<E>>,
  ): Promise<void> {
    const cur = await this.read(entity, id);
    if (!cur) throw new MutatorError('not_found', `${entity} ${id}`);
    const defined = Object.fromEntries(Object.entries(partial).filter(([, v]) => v !== undefined));
    const data = check(entity, { ...cur, ...defined });
    await this.note(entity, id);
    await this.write(entity, id, data);
  }

  async del<E extends EntityName>(entity: E, id: string): Promise<void> {
    await this.note(entity, id);
    await this.write(entity, id, null);
  }

  async scan<E extends EntityName>(
    entity: E,
    opts?: { index: string; eq: unknown },
  ): Promise<Row<E>[]> {
    const rows = await this.scanTable(entity, opts);
    if (!this.overlay?.size) return rows;
    const ov = this.overlay;
    const prefix = overlayKey(entity, '');
    const out = rows.filter((r) => !ov.has(overlayKey(entity, r.id as string)));
    const kept = out.length;
    const eq = opts?.eq ?? null;
    for (const [k, r] of ov)
      if (r && k.startsWith(prefix) && (!opts || (r[opts.index] ?? null) === eq))
        out.push(structuredClone(r) as Row<E>);
    // the same order as Dexie: by id
    return out.length > kept ? out.sort(byId) : out;
  }

  private async scanTable<E extends EntityName>(
    entity: E,
    opts?: { index: string; eq: unknown },
  ): Promise<Row<E>[]> {
    const t = this.table(entity);
    if (!opts) return t.toArray();
    const meta =
      moduleEntities.get(entity)?.meta ??
      (ENTITIES as Record<string, { indexes: string[] }>)[entity];
    if (!meta?.indexes.includes(opts.index)) {
      throw new Error(`scan: индекс ${opts.index} не объявлен у ${entity}`);
    }
    // shortcut: null/undefined are not stored in an IndexedDB index — a full table scan
    if (opts.eq == null) return t.filter((r) => (r[opts.index] ?? null) === null).toArray();
    return t
      .where(opts.index)
      .equals(opts.eq as string)
      .toArray();
  }
}

/** Rolls back the writes by pre-images (in reverse order); with overlay — only in it. */
export async function applyUndo(
  db: PlanarDB,
  undo: Undo[],
  changes?: ReplicaChange[],
  overlay?: Overlay,
): Promise<void> {
  for (let i = undo.length - 1; i >= 0; i--) {
    const u = undo[i];
    if (overlay) overlay.set(overlayKey(u.entity, u.id), u.row);
    else if (u.row) await db.table(u.entity).put(u.row);
    else await db.table(u.entity).delete(u.id);
    changes?.push({ entity: u.entity, id: u.id, row: u.row });
  }
}

/** Writes to Dexie only overlay rows that differ from the stored ones; they go to changes. */
export async function flushOverlay(
  db: PlanarDB,
  overlay: Overlay,
  changes: ReplicaChange[],
): Promise<void> {
  const byEntity = new Map<string, [string, AnyRow | null][]>();
  for (const [k, row] of overlay) {
    const i = k.indexOf('\0');
    const e = k.slice(0, i);
    const list = byEntity.get(e) ?? byEntity.set(e, []).get(e)!;
    list.push([k.slice(i + 1), row]);
  }
  for (const [entity, list] of byEntity) {
    const t = db.table(entity);
    const cur = await t.bulkGet(list.map(([id]) => id));
    const put: AnyRow[] = [];
    const del: string[] = [];
    list.forEach(([id, row], i) => {
      if (same(cur[i] ?? null, row)) return;
      if (row) put.push(row);
      else del.push(id);
      changes.push({ entity, id, row });
    });
    if (put.length) await t.bulkPut(put);
    if (del.length) await t.bulkDelete(del);
  }
}
