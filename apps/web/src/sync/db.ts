import Dexie, { type Table } from 'dexie';
import { ENTITIES } from '@planar/shared';

export interface QueueItem {
  id?: number;
  name: string;
  args: unknown;
  createdAt: string;
  /** pre-images of rows touched by the optimistic apply (for rebase) */
  undo?: Undo[];
}
export interface Undo {
  entity: string;
  id: string;
  row: Record<string, unknown> | null;
}
/** A changed replica row; `entity: '*'` — the replica is replaced entirely (reset everything). */
export interface ReplicaChange {
  entity: string;
  id: string;
  row: Record<string, unknown> | null;
}
export interface MetaRow {
  key: 'clientId' | 'userId' | 'cursor' | 'lastMutationId' | 'schema';
  value: string | number;
}

/** Dexie schema: a table per entity (indexes from meta.indexes) + service ones; extra — module entities. */
export function buildSchema(
  extra: Record<string, string[]> = {},
  skip: string[] = [],
  /** `entity.index`: an index that doesn't exist in this schema version yet */
  omit: string[] = [],
): Record<string, string> {
  const stores: Record<string, string> = { _meta: 'key', _queue: '++id' };
  const entities: Record<string, { indexes: string[] }> = { ...ENTITIES };
  for (const [n, indexes] of Object.entries(extra)) entities[n] = { indexes };
  for (const n of skip) delete entities[n];
  for (const [n, m] of Object.entries(entities))
    stores[n] = ['id', ...m.indexes.filter((i) => !omit.includes(`${n}.${i}`))].join(',');
  return stores;
}

/**
 * Dexie schema version: 3 without modules; with modules it grows on every change of the table/index set
 * (signature and version — in localStorage; no storage → 4, and PlanarDB.open handles the incompatibility).
 */
export function schemaVersion(name: string, extra: Record<string, string[]>): number {
  const names = Object.keys(extra).sort();
  if (!names.length) return 3;
  // the core entity set is in the signature: a new core table (projectMembers, C-schema v17) upgrades the replica too
  const sig = [
    Object.keys(ENTITIES).join(','),
    ...names.map((n) => `${n}:${extra[n]!.join(',')}`),
  ].join(';');
  const key = `planar.dexieSchema.${name}`;
  try {
    const old = JSON.parse(localStorage.getItem(key) ?? 'null') as {
      sig: string;
      v: number;
    } | null;
    const v = !old ? 4 : old.sig === sig ? old.v : old.v + 1;
    if (v !== old?.v) localStorage.setItem(key, JSON.stringify({ sig, v }));
    return v;
  } catch {
    return 4;
  }
}

export class PlanarDB extends Dexie {
  _meta!: Table<MetaRow, string>;
  _queue!: Table<QueueItem, number>;
  constructor(name = 'planar', extra: Record<string, string[]> = {}) {
    super(name);
    // v1 — replica before fieldDefs/taskLinks; v2 adds them (Dexie migrates without data loss)
    this.version(1).stores(buildSchema({}, ['fieldDefs', 'taskLinks']));
    this.version(2).stores(buildSchema({}, [], ['tasks.cycleId']));
    // v3 (C-schema v7): index tasks.cycleId
    this.version(3).stores(buildSchema());
    // v≥4: entities of installed modules (C-modules v4)
    const v = schemaVersion(name, extra);
    if (v > 3) this.version(v).stores(buildSchema(extra));
  }
  /** The version in the database is higher than declared (a module was removed, storage reset) — the replica is recreated, then bootstrap. */
  override open(): ReturnType<Dexie['open']> {
    return super.open().catch(async (e: Error) => {
      if (e.name !== 'VersionError') throw e;
      await this.delete();
      return super.open();
    }) as ReturnType<Dexie['open']>;
  }
  /** Table and index set of this build; stored with the cursor of a bootstrap (`schema` in _meta). */
  schemaSig(): string {
    return this.tables
      .map((t) => `${t.name}:${t.schema.indexes.map((i) => i.name).join(',')}`)
      .sort()
      .join(';');
  }
  /** entity tables (without service ones) */
  entityTables(): Table[] {
    return this.tables.filter((t) => !t.name.startsWith('_'));
  }
}
