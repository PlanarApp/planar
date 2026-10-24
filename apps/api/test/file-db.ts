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
  // базу не роняем здесь (каждый DROP — checkpoint, очередь под нагрузкой): удалит teardown global-setup
  await admin.end();
});
