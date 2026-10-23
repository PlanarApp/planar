import Dexie, { type Table } from 'dexie';
import { ENTITIES } from '@planar/shared';

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
/** Изменённая строка реплики; `entity: '*'` — реплика заменена целиком (сбросить всё). */
export interface ReplicaChange {
  entity: string;
  id: string;
  row: Record<string, unknown> | null;
}
export interface MetaRow {
  key: 'clientId' | 'userId' | 'cursor' | 'lastMutationId';
  value: string | number;
}

/** Схема Dexie: таблица на сущность (индексы из meta.indexes) + служебные; extra — сущности модулей. */
export function buildSchema(
  extra: Record<string, string[]> = {},
  skip: string[] = [],
  /** `entity.index`: индекс, которого в этой версии схемы ещё нет */
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

export class PlanarDB extends Dexie {
  _meta!: Table<MetaRow, string>;
  _queue!: Table<QueueItem, number>;
  constructor(name = 'planar', extra: Record<string, string[]> = {}) {
    super(name);
    // v1 — реплика до fieldDefs/taskLinks; v2 добавляет их (Dexie мигрирует без потери данных)
    this.version(1).stores(buildSchema(extra, ['fieldDefs', 'taskLinks']));
    this.version(2).stores(buildSchema(extra, [], ['tasks.cycleId']));
    // v3 (C-schema v7): индекс tasks.cycleId
    this.version(3).stores(buildSchema(extra));
  }
  /** таблицы сущностей (без служебных) */
  entityTables(): Table[] {
    return this.tables.filter((t) => !t.name.startsWith('_'));
  }
}
