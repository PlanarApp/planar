import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import * as schema from '../../src/db/schema.js';
import { JobsService } from '../../src/jobs/jobs.js';
import { PullService } from '../../src/sync/pull.service.js';
import { PushService } from '../../src/sync/push.service.js';
import { ORIGIN } from '../auth.js';
import { dbUrl, newDb, TestClient, taskArgs, world, type World } from '../sync/helpers.js';

// Real pg-boss: enqueue from the hook and the recurring.spawn worker are not replaced.
const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let w: World;
const DONE = 3;

beforeAll(async () => {
  await db
    .insert(schema.settings)
    .values({ id: 'enabled_modules', value: ['recurring'] })
    .onConflictDoUpdate({ target: schema.settings.id, set: { value: ['recurring'] } });
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN, push: { boss: true } });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  w = await world(db);
  const svc = { push: app.get(PushService), pull: app.get(PullService) };
  for (const c of ['admin', 'member', 'guest', 'outsider'] as const)
    w[c] = new TestClient(svc, w[c].userId);
}, 60_000);
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

const raw = (q: string, a: unknown[] = []) => db.$client.query(q, a).then((r) => r.rows);
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
}
const count = async (title: string) =>
  (await raw('select 1 from tasks where title = $1', [title])).length;

describe('pf1: pg-boss', () => {
  it('pf1: after_done — завершение даёт ровно один экземпляр; повторное завершение не даёт', async () => {
    const title = `AD-${uuidv7()}`;
    const a = taskArgs(w, { title, dueDate: '2026-05-01' });
    await w.admin.ok('task.create', a);
    await w.admin.ok('checklist.add', { id: uuidv7(), taskId: a.id, text: 'x', rank: 'a0' });
    const ruleId = uuidv7();
    await w.admin.ok('recurring.set', {
      id: ruleId,
      taskId: a.id,
      kind: 'after_done',
      every: 3,
      unit: 'day',
      weekdays: [],
      timezone: 'UTC',
    });
    await w.admin.ok('task.update', { id: a.id, statusId: w.statusIds[DONE] });
    expect(
      await until(
        () => count(title),
        (n) => n >= 2,
      ),
    ).toBe(2);
    const [n] = await raw(
      `select id, due_date::text as dd, created_by from tasks where title = $1 and id <> $2`,
      [title, a.id],
    );
    const today = new Date().toISOString().slice(0, 10);
    expect(n.dd).toBe(new Date(Date.parse(today) + 3 * 864e5).toISOString().slice(0, 10));
    expect(n.created_by).toBe(await app.get(JobsService).systemUserId());
    expect((await raw('select * from checklist_items where task_id = $1', [n.id])).length).toBe(1);
    const [r] = await raw('select task_id, next_date from recurring_rules where id = $1', [ruleId]);
    expect(r).toMatchObject({ task_id: n.id, next_date: null });
    // the sample is "reopened" and completed again: the rule already belongs to the new instance
    await w.admin.ok('task.update', { id: a.id, statusId: w.statusIds[1] });
    await w.admin.ok('task.update', { id: a.id, statusId: w.statusIds[DONE] });
    await new Promise((r) => setTimeout(r, 2500));
    expect(await count(title)).toBe(2);
  }, 60_000);

  it('pf1: отмена (cancelled) не создаёт экземпляр; удаление задачи удаляет правило', async () => {
    const title = `CN-${uuidv7()}`;
    const a = taskArgs(w, { title });
    await w.admin.ok('task.create', a);
    await w.admin.ok('recurring.set', {
      id: uuidv7(),
      taskId: a.id,
      kind: 'after_done',
      every: 1,
      unit: 'day',
      weekdays: [],
      timezone: 'UTC',
    });
    await w.admin.ok('task.update', { id: a.id, statusId: w.statusIds[4] });
    await new Promise((r) => setTimeout(r, 2500));
    expect(await count(title)).toBe(1);
    await w.admin.ok('task.delete', { id: a.id });
    expect(await raw('select 1 from recurring_rules where task_id = $1', [a.id])).toHaveLength(0);
  }, 30_000);
});
