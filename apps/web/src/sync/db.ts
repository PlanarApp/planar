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
/** A task whose details (comments, activity…) are held in the replica: loadedAt — loaded, accessedAt — last opened. */
export interface HeldRow {
  taskId: string;
  loadedAt: string;
  accessedAt: string;
}
export interface MetaRow {
  /** protocol — the C-sync version of the last bootstrap (PLNRAPP-487) */
  key: 'clientId' | 'userId' | 'cursor' | 'lastMutationId' | 'schema' | 'protocol';
  value: string | number;
}

/** Replica-only indexes of core entities (no server index behind them). */
const CLIENT_INDEXES: Record<string, string[]> = {
  tasks: ['createdBy', '[projectId+number]'],
  projects: ['key'],
};

/** Core indexes and service tables that appeared in v4 — absent from the declarations of v1–v3. */
const SINCE_V4 = {
  skip: ['_held'],
  omit: ['tasks.createdBy', 'tasks.[projectId+number]', 'projects.key'],
};

/**
 * Dexie schema: a table per entity (indexes from meta.indexes + CLIENT_INDEXES) + service ones;
 * extra — module entities; skip — tables (incl. service ones) absent from this schema version.
 */
export function buildSchema(
  extra: Record<string, string[]> = {},
  skip: string[] = [],
  /** `entity.index`: an index that doesn't exist in this schema version yet */
  omit: string[] = [],
): Record<string, string> {
  const stores: Record<string, string> = {
    _meta: 'key',
    _queue: '++id',
    _held: 'taskId,accessedAt',
  };
  const entities: Record<string, { indexes: string[] }> = {};
  for (const [n, m] of Object.entries(ENTITIES))
    entities[n] = { indexes: [...m.indexes, ...(CLIENT_INDEXES[n] ?? [])] };
  for (const [n, indexes] of Object.entries(extra)) entities[n] = { indexes };
  for (const n of skip) {
    delete entities[n];
    delete stores[n];
  }
  for (const [n, m] of Object.entries(entities))
    stores[n] = ['id', ...m.indexes.filter((i) => !omit.includes(`${n}.${i}`))].join(',');
  return stores;
}

/** v4 — core: table _held, index tasks.createdBy (v1–v3 — older core, declared in PlanarDB). */
const CORE_VERSION = 4;

/**
 * Dexie schema version: ≥ 4; grows on every change of the full schema — tables and indexes of the core
 * and of modules (signature and version — in localStorage; no storage → 4 without modules, 5 with them,
 * and PlanarDB.open handles the incompatibility).
 */
export function schemaVersion(name: string, extra: Record<string, string[]>): number {
  const names = Object.keys(extra).sort();
  const sig = JSON.stringify(buildSchema(Object.fromEntries(names.map((n) => [n, extra[n]!]))));
  const fallback = names.length ? CORE_VERSION + 1 : CORE_VERSION;
  const key = `planar.dexieSchema.${name}`;
  try {
    const old = JSON.parse(localStorage.getItem(key) ?? 'null') as {
      sig: string;
      v: number;
    } | null;
    const v = !old ? fallback : old.sig === sig ? old.v : Math.max(old.v + 1, fallback);
    if (old?.sig !== sig || old.v !== v) localStorage.setItem(key, JSON.stringify({ sig, v }));
    return v;
  } catch {
    return fallback;
  }
}

/**
 * Data signature of a replica: the set of entity tables, without indexes and service tables.
 * A new index is built by Dexie over the rows already present — bootstrap is needed only for a new table.
 * Also accepts the older format `table:index,…` (with service tables) — it reduces to the same signature.
 */
export function dataSig(sig: string): string {
  return sig
    .split(';')
    .map((t) => t.split(':')[0]!)
    .filter((t) => t && !t.startsWith('_'))
    .sort()
    .join(';');
}

export class PlanarDB extends Dexie {
  _meta!: Table<MetaRow, string>;
  _queue!: Table<QueueItem, number>;
  _held!: Table<HeldRow, string>;
  constructor(name = 'planar', extra: Record<string, string[]> = {}) {
    super(name);
    // v1 — replica before fieldDefs/taskLinks; v2 adds them (Dexie migrates without data loss)
    const { skip, omit } = SINCE_V4;
    this.version(1).stores(buildSchema({}, ['fieldDefs', 'taskLinks', ...skip], omit));
    this.version(2).stores(buildSchema({}, skip, ['tasks.cycleId', ...omit]));
    // v3 (C-schema v7): index tasks.cycleId
    this.version(3).stores(buildSchema({}, skip, omit));
    // v≥4: core v4 (_held, tasks.createdBy) + entities of installed modules (C-modules v4)
    this.version(schemaVersion(name, extra)).stores(buildSchema(extra));
  }
  /** The version in the database is higher than declared (a module was removed, storage reset) — the replica is recreated, then bootstrap. */
  override open(): ReturnType<Dexie['open']> {
    return super.open().catch(async (e: Error) => {
      if (e.name !== 'VersionError') throw e;
      await this.delete();
      return super.open();
    }) as ReturnType<Dexie['open']>;
  }
  /** Entity table set of this build (dataSig); stored with the cursor of a bootstrap (`schema` in _meta). */
  schemaSig(): string {
    return dataSig(this.tables.map((t) => t.name).join(';'));
  }
  /** entity tables (without service ones) */
  entityTables(): Table[] {
    return this.tables.filter((t) => !t.name.startsWith('_'));
  }
}
