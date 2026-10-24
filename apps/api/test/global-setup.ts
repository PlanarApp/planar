import { spawn } from 'node:child_process';
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
  // осиротевшие базы прошлых прогонов: свои префиксы, без соединений, старше часа
  const { rows: old } = await admin.query<{ datname: string }>(
    `select datname from pg_database d where datname ~ '^planar_t(pl)?_' and not exists
       (select 1 from pg_stat_activity a where a.datname = d.datname)
       and (pg_stat_file('base/' || d.oid || '/PG_VERSION')).modification < now() - interval '1 hour'`,
  );
  for (const { datname } of old)
    await admin.query(`drop database if exists ${datname} with (force)`).catch(() => {});
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
  // страховка на падение/SIGINT/SIGTERM/SIGKILL: отдельный процесс дожидается выхода vitest и добивает базы
  const watcher = `
    const pg = require('pg'); const [pid, url, name] = process.argv.slice(1);
    const alive = () => { try { process.kill(+pid, 0); return true; } catch { return false; } };
    (async () => {
      while (alive()) await new Promise((r) => setTimeout(r, 500));
      await new Promise((r) => setTimeout(r, 1000));
      for (let i = 0; i < 5; i++) {
        const c = new pg.Client({ connectionString: url });
        try {
          await c.connect();
          const { rows } = await c.query('select datname from pg_database where datname = $1 or datname like $2', [name, name + '\\\\_%']);
          for (const { datname } of rows) await c.query('drop database if exists ' + datname + ' with (force)');
          return;
        } catch { await new Promise((r) => setTimeout(r, 2000)); } finally { await c.end().catch(() => {}); }
      }
    })();`;
  spawn(process.execPath, ['-e', watcher, String(process.pid), ADMIN_URL, name], {
    cwd: import.meta.dirname,
    detached: true,
    stdio: 'ignore',
  }).unref();
  return async () => {
    const { rows } = await admin.query<{ datname: string }>(
      `select datname from pg_database where datname like $1`,
      [`${name}\\_%`],
    );
    await admin.query('set statement_timeout = 60000');
    await admin.query('select pg_advisory_lock(7240001)').catch(() => {});
    for (const { datname } of [...rows, { datname: name }])
      await admin.query(`drop database if exists ${datname} with (force)`).catch(() => {});
    await admin.end();
  };
}
