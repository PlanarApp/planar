import { createDb, type Db } from '../src/db/index.js';

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
  const db = createDb(testDbUrl());
  pools.push(db);
  return db;
};

export const closePools = () =>
  Promise.all(pools.map((d) => (d.$client.ended ? undefined : d.$client.end())));
