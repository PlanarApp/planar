import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };

export function createDb(connectionString: string, max?: number): Db {
  const pool = new pg.Pool({ connectionString, ...(max && { max }) });
  return drizzle({ client: pool, schema, casing: 'snake_case' });
}

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Applies migrations from apps/api/drizzle; no journal — not an error. */
export async function migrate(db: Db, folder = migrationsFolder): Promise<void> {
  if (!existsSync(`${folder}/meta/_journal.json`)) return;
  await drizzleMigrate(db, { migrationsFolder: folder });
}
