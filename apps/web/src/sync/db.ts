import Dexie, { type Table } from 'dexie';
import { ENTITIES } from './shared';

export interface QueueItem {
  id?: number;
  name: string;
  args: unknown;
  createdAt: string;
  /** прообразы строк, затронутых оптимистичным применением (для rebase) */
  undo?: Undo[];
}
export interface Undo {
  entity: string;
  id: string;
  row: Record<string, unknown> | null;
}
export interface MetaRow {
  key: 'clientId' | 'cursor' | 'lastMutationId';
  value: string | number;
}

/** Схема Dexie: таблица на сущность (индексы из meta.indexes) + служебные; extra — сущности модулей. */
export function buildSchema(extra: Record<string, string[]> = {}): Record<string, string> {
  const stores: Record<string, string> = { _meta: 'key', _queue: '++id' };
  const entities: Record<string, { indexes: string[] }> = { ...ENTITIES };
  for (const [n, indexes] of Object.entries(extra)) entities[n] = { indexes };
  for (const [n, m] of Object.entries(entities)) stores[n] = ['id', ...m.indexes].join(',');
  return stores;
}

export class PlanarDB extends Dexie {
  _meta!: Table<MetaRow, string>;
  _queue!: Table<QueueItem, number>;
  constructor(name = 'planar', extra: Record<string, string[]> = {}) {
    super(name);
    this.version(1).stores(buildSchema(extra));
  }
  /** таблицы сущностей (без служебных) */
  entityTables(): Table[] {
    return this.tables.filter((t) => !t.name.startsWith('_'));
  }
}
