import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyBetween } from 'fractional-indexing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { CORE } from '@planar/server-kit';
import { createApp } from '../../src/app.js';
import { JobsService } from '../../src/jobs/jobs.js';
import * as schema from '../../src/db/schema.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, key, newDb, taskArgs, world, type World } from '../sync/helpers.js';

// Real pg-boss: the import.run job is enqueued from the controller; the sweep (once a minute) is not needed.
const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let w: World;
let cookie: string;

beforeAll(async () => {
  await db
    .insert(schema.settings)
    .values({ id: 'enabled_modules', value: ['import'] })
    .onConflictDoUpdate({ target: schema.settings.id, set: { value: ['import'] } });
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN, push: { boss: true } });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  // vitest without decorator metadata: @Optional() JobsService in CoreService stays undefined — wire it by hand
  (app.get(CORE) as unknown as { jobs: JobsService }).jobs = app.get(JobsService);
  w = await world(db);
  cookie = await loginCookie(db, w.admin.userId);
}, 60_000);
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

async function start(projectId: string, csv: string, mapping: object) {
  const b = '----wk6b';
  const f = (k: string, v: string) =>
    `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  const payload =
    f('projectId', projectId) +
    f('format', 'csv') +
    f('preset', 'custom') +
    f('mapping', JSON.stringify(mapping)) +
    `--${b}\r\nContent-Disposition: form-data; name="file"; filename="f.csv"\r\nContent-Type: text/csv\r\n\r\n${csv}\r\n--${b}--\r\n`;
  const res = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/import/jobs',
      headers: { cookie, origin: ORIGIN, 'content-type': `multipart/form-data; boundary=${b}` },
      payload,
    });
  expect(res.statusCode, res.body).toBe(202);
  return res.json().data.id as string;
}
async function finished(id: string, ms = 10_000) {
  const end = Date.now() + ms;
  for (;;) {
    const r = (
      await db.$client.query('select status, processed from import_jobs where id = $1', [id])
    ).rows[0] as { status: string; processed: number };
    if (r.status === 'done' || r.status === 'failed' || Date.now() > end) return r;
    await new Promise((r) => setTimeout(r, 200));
  }
}
async function project() {
  const id = uuidv7();
  await w.admin.ok('project.create', { id, spaceId: w.spaceId, name: 'P', key: key(), rank: 'a0' });
  return id;
}

describe('wk6b: мгновенный старт и ранги', () => {
  it('wk6b: задача стартует без ожидания sweep (меньше 10 с)', async () => {
    const p = await project();
    const t0 = Date.now();
    const id = await start(p, 'Title\nA\nB\n', { title: 'Title' });
    const r = await finished(id);
    expect(r).toMatchObject({ status: 'done', processed: 2 });
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it('wk6b: ранги новых задач — generateKeyBetween после последней задачи статуса', async () => {
    const p = await project();
    const st = w.statusIds[4]!;
    const a = taskArgs(w, { projectId: p, statusId: st, rank: 'a5' });
    await w.admin.ok('task.create', a);
    const id = await start(p, 'Title,S\nN1,x\nN2,x\nN3,x\n', {
      title: 'Title',
      status: 'S',
      statusMap: { x: st },
    });
    expect((await finished(id)).status).toBe('done');
    const rows = (
      await db.$client.query(
        'select rank collate "C" as rank from tasks where project_id = $1 order by 1',
        [p],
      )
    ).rows.map((r) => r.rank as string);
    const k1 = generateKeyBetween('a5', null);
    expect(rows).toEqual([
      'a5',
      k1,
      generateKeyBetween(k1, null),
      generateKeyBetween(generateKeyBetween(k1, null), null),
    ]);
  });

  it('wk6b: ранги чек-листа trello возрастают и допустимы', async () => {
    const p = await project();
    const trello = readFileSync(join(__dirname, '../../../../e2e/fixtures/import/trello.json'));
    const b = '----wk6c';
    const f = (k: string, v: string) =>
      `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
    const payload = Buffer.concat([
      Buffer.from(f('projectId', p) + f('format', 'trello') + f('preset', 'trello')),
      Buffer.from(
        `--${b}\r\nContent-Disposition: form-data; name="file"; filename="t.json"\r\n\r\n`,
      ),
      trello,
      Buffer.from(`\r\n--${b}--\r\n`),
    ]);
    const res = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/import/jobs',
        headers: { cookie, origin: ORIGIN, 'content-type': `multipart/form-data; boundary=${b}` },
        payload,
      });
    expect(res.statusCode, res.body).toBe(202);
    expect((await finished(res.json().data.id)).status).toBe('done');
    const ranks = (
      await db.$client.query(
        'select c.rank collate "C" as rank from checklist_items c join tasks t on t.id = c.task_id where t.project_id = $1 order by t.id, 1',
        [p],
      )
    ).rows.map((r) => r.rank as string);
    expect(ranks.length).toBeGreaterThanOrEqual(2);
    expect(ranks[0]).toBe('a0');
    expect(ranks[1]).toBe(generateKeyBetween('a0', null));
  });
});
