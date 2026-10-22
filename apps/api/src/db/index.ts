import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool };

export function createDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString });
  return drizzle({ client: pool, schema, casing: 'snake_case' });
}

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Применяет миграции из apps/api/drizzle; нет журнала — не ошибка. */
export async function migrate(db: Db, folder = migrationsFolder): Promise<void> {
  if (!existsSync(`${folder}/meta/_journal.json`)) return;
  await drizzleMigrate(db, { migrationsFolder: folder });
}
