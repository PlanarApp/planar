import { getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { entitySchemas, type EntityName } from '@planar/shared';
import * as schema from '../db/schema.js';

/** Таблица Drizzle сущности: имя сущности = имя экспорта schema.ts. */
export const tableOf = (e: EntityName): PgTable => schema[e] as unknown as PgTable;

export const entityNames = Object.keys(entitySchemas) as EntityName[];

/** timestamptz строкой из pg ("2026-10-22 10:00:00.123+00") → ISO UTC. */
export function toIso(s: string): string {
  const t = s.replace(' ', 'T');
  return new Date(/[+-]\d\d$/.test(t) ? `${t}:00` : t).toISOString();
}

const tsKeys = new Map<EntityName, string[]>();
function tsKeysOf(e: EntityName): string[] {
  let keys = tsKeys.get(e);
  if (!keys) {
    keys = Object.entries(getTableColumns(tableOf(e)))
      .filter(([, c]) => c.columnType === 'PgTimestampString')
      .map(([k]) => k);
    tsKeys.set(e, keys);
  }
  return keys;
}

/** Строка БД → строка провода: только поля контракта (без password_hash, task_counter), ts в ISO. */
export function toWire(e: EntityName, dbRow: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const ts = tsKeysOf(e);
  for (const k of Object.keys(entitySchemas[e].shape)) {
    const v = dbRow[k];
    out[k] = v == null ? null : ts.includes(k) ? toIso(v as string) : v;
  }
  return out;
}
