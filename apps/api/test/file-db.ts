import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, inject } from 'vitest';
import { closePools, setFileDbUrl } from './db.js';

// Имя начинается с имени шаблона: global-setup в teardown добивает оставшиеся.
const name = `${inject('dbTemplate')}_${randomBytes(4).toString('hex')}`;
const adminUrl = inject('dbAdminUrl');
const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`create database ${name} template ${inject('dbTemplate')}`);
const url = new URL(adminUrl);
url.pathname = `/${name}`;
setFileDbUrl(url.toString());

afterAll(async () => {
  await closePools();
  // drop with (force) рвёт чужие пулы → uncaught 57P01; при живых соединениях оставляем базу teardown'у
  const { rows } = await admin.query('select 1 from pg_stat_activity where datname = $1', [name]);
  if (!rows.length) {
    // Параллельные DROP DATABASE (в т.ч. чужих прогонов на общем сервере) могут взаимно виснуть
    // (барьер procsignal): по одному под advisory-локом, с таймаутом; не вышло — добьёт teardown.
    try {
      await admin.query('set statement_timeout = 7000');
      await admin.query('select pg_advisory_lock(7240001)');
      await admin.query(`drop database if exists ${name} with (force)`);
    } catch {
      /* база останется до teardown */
    }
  }
  await admin.end();
});
