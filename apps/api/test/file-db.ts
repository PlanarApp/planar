import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, inject } from 'vitest';
import { closePools, setFileDbUrl } from './db.js';

// The name starts with the template name: global-setup in teardown finishes the remaining ones.
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
  // we do not drop the database here (every DROP is a checkpoint, the queue under load): teardown of global-setup will delete it
  await admin.end();
});
