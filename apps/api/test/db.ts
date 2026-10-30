import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';

/** Test pool: small, with headroom for connection timeouts under host load. */
export const createTestDb = (url: string): Db => {
  const pool = new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 20_000 });
  // dropDb breaks idle connections (drop database ... force); without a listener that is an unhandled error
  pool.on('error', () => {});
  return drizzle({ client: pool, schema, casing: 'snake_case' });
};

/** Drops the with (force) database (it breaks connections itself) under an advisory lock; one pass, DROP ≤ 60 s, test wk13 gives 80 s (calls only wk13; afterAll does not drop the file's database). If it fails, teardown will finish it. */
export async function dropDb(admin: pg.Client, name: string) {
  for (let attempt = 0; attempt < 1; attempt++) {
    try {
      await admin.query('set statement_timeout = 60000');
      await admin.query('select pg_advisory_lock(7240001)');
      try {
        await admin.query(`drop database if exists ${name} with (force)`);
      } finally {
        await admin.query('select pg_advisory_unlock(7240001)').catch(() => {});
      }
      return;
    } catch {
      /* timeout under load: retry; if it fails, teardown/global-setup safety net finishes it */
    }
  }
}

let fileDbUrl: string | undefined;
const pools: Db[] = [];

/** Calls file-db.ts: the database of the current test file. */
export const setFileDbUrl = (url: string) => {
  fileDbUrl = url;
};

/** URL of the current test file's database (a copy of the template, see file-db.ts). */
export const testDbUrl = () => {
  if (!fileDbUrl) throw new Error('База файла не создана: нет setupFiles file-db.ts');
  return fileDbUrl;
};

/** Pool to the file's database; closes itself in afterAll (a repeated end() is safe). */
export const testDb = (): Db => {
  const db = createTestDb(testDbUrl());
  pools.push(db);
  return db;
};

/** Closes pools, but waits no longer than 2 s: an unreturned client must not hang the hook (drop with force will break it). */
export const closePools = () =>
  Promise.race([
    Promise.all(pools.map((d) => (d.$client.ended ? undefined : d.$client.end()))).catch(() => {}),
    new Promise((r) => setTimeout(r, 2000)),
  ]);
