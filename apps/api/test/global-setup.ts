import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { createDb, migrate } from '../src/db/index.js';

const ADMIN_URL = process.env.TESTDB_URL ?? 'postgres://postgres:postgres@localhost:55432/postgres';

declare module 'vitest' {
  export interface ProvidedContext {
    dbTemplate: string;
    dbAdminUrl: string;
  }
}

/** Шаблонная база planar_tpl_<random>: мигрирует; файлы тестов копируют её (file-db.ts). */
export default async function setup(project: TestProject) {
  const name = `planar_tpl_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  try {
    await admin.connect();
  } catch (e) {
    throw new Error(`Нет тестовой базы (${(e as Error).message}): запусти ./dev.sh testdb`);
  }
  await admin.query(`create database ${name}`);
  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const db = createDb(url.toString());
  try {
    await migrate(db);
  } finally {
    await db.$client.end();
  }
  project.provide('dbTemplate', name);
  project.provide('dbAdminUrl', ADMIN_URL);
  return async () => {
    const { rows } = await admin.query<{ datname: string }>(
      `select datname from pg_database where datname like $1`,
      [`${name}\\_%`],
    );
    await admin.query('set statement_timeout = 8000');
    await admin.query('select pg_advisory_lock(7240001)').catch(() => {});
    for (const { datname } of [...rows, { datname: name }])
      await admin.query(`drop database if exists ${datname} with (force)`).catch(() => {});
    await admin.end();
  };
}
