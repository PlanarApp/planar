import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Db } from '../src/db/index.js';
import * as schema from '../src/db/schema.js';

/** Пул теста: небольшой, с запасом на таймаут подключения под нагрузкой хоста. */
export const createTestDb = (url: string): Db =>
  drizzle({
    client: new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 20_000 }),
    schema,
    casing: 'snake_case',
  });

/** Ждёт ухода соединений и удаляет базу (по одной, под advisory-локом); не вышло — добьёт teardown. */
export async function dropDb(admin: pg.Client, name: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      for (let i = 0; i < 100; i++) {
        const r = await admin.query('select 1 from pg_stat_activity where datname = $1', [name]);
        if (r.rowCount === 0) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      await admin.query('set statement_timeout = 25000');
      await admin.query('select pg_advisory_lock(7240001)');
      await admin.query(`drop database if exists ${name} with (force)`);
      return;
    } catch {
      /* таймаут под нагрузкой: повтор; не вышло — добьёт teardown/страховка global-setup */
    }
  }
}

let fileDbUrl: string | undefined;
const pools: Db[] = [];

/** Вызывает file-db.ts: база текущего файла тестов. */
export const setFileDbUrl = (url: string) => {
  fileDbUrl = url;
};

/** URL базы текущего файла тестов (копия шаблона, см. file-db.ts). */
export const testDbUrl = () => {
  if (!fileDbUrl) throw new Error('База файла не создана: нет setupFiles file-db.ts');
  return fileDbUrl;
};

/** Пул к базе файла; закрывается сам в afterAll (повторный end() безопасен). */
export const testDb = (): Db => {
  const db = createTestDb(testDbUrl());
  pools.push(db);
  return db;
};

export const closePools = () =>
  Promise.all(pools.map((d) => (d.$client.ended ? undefined : d.$client.end())));
