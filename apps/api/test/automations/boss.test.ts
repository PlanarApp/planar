import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import * as schema from '../../src/db/schema.js';
import { PullService } from '../../src/sync/pull.service.js';
import { PushService } from '../../src/sync/push.service.js';
import { ORIGIN } from '../auth.js';
import { dbUrl, key, newDb, TestClient, taskArgs, world, type World } from '../sync/helpers.js';

// Настоящий pg-boss: enqueue из хука и воркер automations.run не подменяются.
const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let w: World;
let P: string;
const [TODO, PROG, , DONE] = [1, 2, 3, 3];

const setModules = (v: string[]) =>
  db
    .insert(schema.settings)
    .values({ id: 'enabled_modules', value: v })
    .onConflictDoUpdate({ target: schema.settings.id, set: { value: v } });

beforeAll(async () => {
  await setModules(['automations']);
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN, push: { boss: true } });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  w = await world(db);
  const svc = { push: app.get(PushService), pull: app.get(PullService) };
  for (const c of ['admin', 'member', 'guest', 'outsider'] as const)
    w[c] = new TestClient(svc, w[c].userId);
}, 60_000);
beforeEach(async () => {
  P = uuidv7();
  await w.admin.ok('project.create', {
    id: P,
    spaceId: w.spaceId,
    name: 'P',
    key: key(),
    rank: 'a0',
  });
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

const runs = (ruleId: string) =>
  db.$client
    .query('select * from automations_runs where rule_id = $1 order by created_at, id', [ruleId])
    .then((r) => r.rows);
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (ok(v) || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
}
const rule = async (trigger: object, actions: object[]) => {
  const id = uuidv7();
  await w.admin.ok('automations.create', { id, projectId: P, name: 'R', trigger, actions });
  return id;
};
const task = async (over: Record<string, unknown> = {}) => {
  const a = taskArgs(w, { projectId: P, ...over });
  await w.admin.ok('task.create', a);
  return a.id;
};
const row = async (id: string) =>
  (await db.select().from(schema.tasks).where(eq(schema.tasks.id, id)))[0]!;

describe('wk3: pg-boss', () => {
  it('wk3: правило срабатывает через очередь', async () => {
    const r = await rule({ type: 'task.created' }, [
      { type: 'set_status', statusId: w.statusIds[PROG] },
    ]);
    const t = await task();
    const got = await until(
      () => runs(r),
      (x) => x.length > 0,
    );
    expect(got).toMatchObject([{ status: 'ok', task_id: t, depth: 1 }]);
    expect((await row(t)).statusId).toBe(w.statusIds[PROG]);
  }, 40_000);

  it('wk3: два правила по кругу обрываются на глубине 3', async () => {
    const p = uuidv7();
    await w.admin.ok('project.create', {
      id: p,
      spaceId: w.spaceId,
      name: 'C',
      key: key(),
      rank: 'a0',
    });
    const mk = async (trigger: object, actions: object[]) => {
      const id = uuidv7();
      await w.admin.ok('automations.create', { id, projectId: p, name: 'C', trigger, actions });
      return id;
    };
    const a = await mk({ type: 'task.field_changed', field: 'priority' }, [
      { type: 'set_status', statusId: w.statusIds[DONE] },
    ]);
    const b = await mk({ type: 'task.status_changed' }, [
      { type: 'set_field', field: 'priority', value: 1 },
    ]);
    const args = taskArgs(w, { projectId: p });
    await w.admin.ok('task.create', args);
    await w.admin.ok('task.update', { id: args.id, priority: 4 });
    const total = async () => (await runs(a)).length + (await runs(b)).length;
    await until(total, (n) => n >= 3);
    await new Promise((r) => setTimeout(r, 2000));
    const all = [...(await runs(a)), ...(await runs(b))];
    expect(all.length).toBeLessThanOrEqual(3);
    expect(Math.max(...all.map((x) => x.depth))).toBeLessThanOrEqual(3);
    expect(all.every((x) => x.status === 'ok')).toBe(true);
  }, 60_000);

  it('wk3: ошибка действия — запуск error, задача цела', async () => {
    const r = await rule({ type: 'task.created' }, [{ type: 'set_status', statusId: uuidv7() }]);
    const t = await task();
    const got = await until(
      () => runs(r),
      (x) => x.length > 0,
    );
    expect(got[0]).toMatchObject({ status: 'error', task_id: t });
    expect((await row(t)).statusId).toBe(w.statusIds[TODO]);
  }, 40_000);

  it('wk3: модуль выключен — хук не ставит задачи; включён — ставит', async () => {
    const r = await rule({ type: 'task.created' }, [
      { type: 'set_status', statusId: w.statusIds[PROG] },
    ]);
    await setModules([]);
    const off = await task();
    await new Promise((x) => setTimeout(x, 2500));
    expect(await runs(r)).toHaveLength(0);
    expect((await row(off)).statusId).toBe(w.statusIds[TODO]);
    await setModules(['automations']);
    const on = await task();
    const got = await until(
      () => runs(r),
      (x) => x.length > 0,
    );
    expect(got).toMatchObject([{ status: 'ok', task_id: on }]);
  }, 60_000);
});
