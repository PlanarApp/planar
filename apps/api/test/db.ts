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

/** Удаляет базу with (force) (рвёт соединения сам) под advisory-локом; худший случай ≈ 2+2×(15+15) с < hookTimeout. Не вышло — добьёт teardown. */
export async function dropDb(admin: pg.Client, name: string) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await admin.query('set statement_timeout = 15000');
      await admin.query('select pg_advisory_lock(7240001)');
      try {
        await admin.query(`drop database if exists ${name} with (force)`);
      } finally {
        await admin.query('select pg_advisory_unlock(7240001)').catch(() => {});
      }
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

/** Закрывает пулы, но не ждёт дольше 2 с: невозвращённый клиент не должен вешать хук (drop with force его оборвёт). */
export const closePools = () =>
  Promise.race([
    Promise.all(pools.map((d) => (d.$client.ended ? undefined : d.$client.end()))).catch(() => {}),
    new Promise((r) => setTimeout(r, 2000)),
  ]);
