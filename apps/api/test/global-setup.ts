import { randomBytes } from 'node:crypto';
import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { createDb, migrate } from '../src/db/index.js';

const ADMIN_URL = process.env.TESTDB_URL ?? 'postgres://postgres:postgres@localhost:55432/postgres';

declare module 'vitest' {
  export interface ProvidedContext {
    dbUrl: string;
  }
}

/** Создаёт базу planar_t_<random> в planar-testdb, мигрирует, удаляет в teardown. */
export default async function setup(project: TestProject) {
  const name = `planar_t_${randomBytes(6).toString('hex')}`;
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
  project.provide('dbUrl', url.toString());
  return async () => {
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  };
}
