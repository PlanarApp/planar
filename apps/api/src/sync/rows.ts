import { getTableColumns } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import { ENTITIES, entitySchemas, type EntityMeta, type EntityName } from '@planar/shared';
import { installed, moduleTables } from '../modules/installed.js';
import * as schema from '../db/schema.js';

const modTables = moduleTables();
const modEntities = Object.assign({}, ...installed.map((m) => m.api.entities)) as Record<
  string,
  { schema: z.ZodObject; meta: EntityMeta }
>;

/** Drizzle table of an entity: entity name = export name in schema.ts (core) or the module's api/schema.ts. */
export const tableOf = (e: string): PgTable =>
  ((schema as Record<string, unknown>)[e] as PgTable | undefined) ?? modTables.get(e)!;

export const schemaOf = (e: string): z.ZodObject =>
  (entitySchemas as Record<string, z.ZodObject>)[e] ?? modEntities[e]!.schema;

export const metaOf = (e: string): EntityMeta =>
  (ENTITIES as Record<string, EntityMeta>)[e] ?? modEntities[e]!.meta;

/** Meta of all entities: core and installed modules (enabled or not). */
export const allMetas = (): Record<string, EntityMeta> => ({
  ...(ENTITIES as Record<string, EntityMeta>),
  ...Object.fromEntries(Object.entries(modEntities).map(([k, v]) => [k, v.meta])),
});

export const entityNames = Object.keys(entitySchemas) as EntityName[];

/** timestamptz as a string from pg ("2026-10-22 10:00:00.123+00") → ISO UTC. */
export function toIso(s: string): string {
  const t = s.replace(' ', 'T');
  return new Date(/[+-]\d\d$/.test(t) ? `${t}:00` : t).toISOString();
}

const tsKeys = new Map<string, string[]>();
function tsKeysOf(e: string): string[] {
  let keys = tsKeys.get(e);
  if (!keys) {
    keys = Object.entries(getTableColumns(tableOf(e)))
      .filter(([, c]) => c.columnType === 'PgTimestampString')
      .map(([k]) => k);
    tsKeys.set(e, keys);
  }
  return keys;
}

/** DB row → wire row: only contract fields (no password_hash, task_counter), ts in ISO. */
export function toWire(e: string, dbRow: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const ts = tsKeysOf(e);
  for (const k of Object.keys(schemaOf(e).shape)) {
    const v = dbRow[k];
    out[k] = v == null ? null : ts.includes(k) ? toIso(v as string) : v;
  }
  return out;
}
