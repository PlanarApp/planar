// PLNRAPP-154: archived tasks, pages and channels are deleted by the purge jobs after ARCHIVE_DAYS.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { archivePurge } from '../../src/jobs/archive.js';
import type { JobApi, JobDef } from '../../src/modules/hooks.js';
import { installed } from '../../src/modules/installed.js';
import { PushQueue } from '../../src/push/push.js';
import {
  dbUrl,
  mkUser,
  newDb,
  services,
  taskArgs,
  TestClient,
  world,
  type World,
} from '../sync/helpers.js';

const db = newDb();
const queue = new PushQueue(db, { boss: false, databaseUrl: dbUrl });
let w: World;
let api: JobApi;

beforeAll(async () => {
  w = await world(db);
  const iadmin = new TestClient(services(db), await mkUser(db, 'admin'));
  await iadmin.ok('settings.set', { id: 'enabled_modules', value: ['chat'] });
  api = await queue.jobs.api();
});
afterAll(async () => {
  await queue.onApplicationShutdown();
  await db.$client.end();
});

const raw = (q: string, a: unknown[] = []) => db.$client.query(q, a).then((r) => r.rows);
const age = (table: string, id: string, days: number) =>
  raw(`update ${table} set archived_at = now() - make_interval(days => $2) where id = $1`, [
    id,
    days,
  ]);
const exists = async (table: string, id: string) =>
  (await raw(`select 1 from ${table} where id = $1`, [id])).length > 0;
const job = (m: string) => (installed.find((x) => x.api.id === m)!.api.jobs as JobDef[])[0]!;

describe('archive purge', () => {
  it('удаляет архив старше 30 дней (задача с подзадачей, страница, канал); свежий архив и живые — нет', async () => {
    const old = taskArgs(w);
    const sub = taskArgs(w, { parentId: old.id });
    const fresh = taskArgs(w);
    const live = taskArgs(w);
    for (const t of [old, sub, fresh, live]) await w.member.ok('task.create', t);
    await w.member.ok('task.archive', { id: old.id });
    await w.member.ok('task.archive', { id: fresh.id });
    await age('tasks', old.id, 31);
    await age('tasks', sub.id, 31);
    await age('tasks', fresh.id, 29);

    const page = { id: uuidv7(), spaceId: w.spaceId, projectId: w.projectId, rank: 'a0' };
    await w.member.ok('docs.page.create', page);
    await w.member.ok('docs.page.archive', { id: page.id });
    await age('docs_pages', page.id, 31);

    const ch = uuidv7();
    await w.member.ok('chat.channel.create', {
      id: ch,
      spaceId: w.spaceId,
      projectId: w.projectId,
      name: 'old',
    });
    await w.member.ok('chat.channel.update', { id: ch, archivedAt: new Date().toISOString() });
    await age('chat_channels', ch, 31);

    await archivePurge.handler({}, api);
    await job('docs').handler({}, api);
    await job('chat').handler({}, api);

    expect(await exists('tasks', old.id)).toBe(false);
    expect(await exists('tasks', sub.id)).toBe(false);
    expect(await exists('tasks', fresh.id)).toBe(true);
    expect(await exists('tasks', live.id)).toBe(true);
    expect(await exists('docs_pages', page.id)).toBe(false);
    expect(await exists('chat_channels', ch)).toBe(false);
  });
});
