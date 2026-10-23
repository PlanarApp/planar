import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CoreService } from '../../src/core.service.js';
import { uuidv7 } from '@planar/shared';
import { todayIn } from '@planar/module-sprints/shared';
import * as schema from '../../src/db/schema.js';
import type { JobApi } from '../../src/modules/hooks.js';
import { installed } from '../../src/modules/installed.js';
import { PushQueue } from '../../src/push/push.js';
import {
  TestClient,
  dbUrl,
  key,
  newDb,
  services,
  taskArgs,
  world,
  type World,
} from '../sync/helpers.js';

const db = newDb();
const queue = new PushQueue(db, { boss: false, databaseUrl: dbUrl });
let w: World;
const [BACKLOG, TODO, , DONE, CANCELLED] = [0, 1, 2, 3, 4];

beforeAll(async () => {
  w = await world(db);
  await db
    .insert(schema.settings)
    .values({ id: 'enabled_modules', value: ['sprints'] })
    .onConflictDoUpdate({ target: schema.settings.id, set: { value: ['sprints'] } });
});
afterAll(async () => {
  await queue.onApplicationShutdown();
  await db.$client.end();
});

const raw = (table: string, where = '') =>
  db.$client
    .query(
      `select *${table === 'sprints_cycles' ? ', start_date::text as sd, end_date::text as ed' : ''} from ${table} ${where}`,
    )
    .then((r) => r.rows);
const cycle = async (id: string) => (await raw('sprints_cycles', `where id = '${id}'`))[0];
const cycles = (projectId: string) =>
  raw('sprints_cycles', `where project_id = '${projectId}' order by number`);
const taskCycle = async (id: string) =>
  (await db.select().from(schema.tasks).where(eq(schema.tasks.id, id)))[0]!.cycleId;

async function project() {
  const id = uuidv7();
  await w.admin.ok('project.create', { id, spaceId: w.spaceId, name: 'P', key: key(), rank: 'a0' });
  return id;
}
async function cfg(projectId: string, over: Record<string, unknown> = {}) {
  await w.admin.ok('sprints.configure', { projectId, ...over });
}
async function mk(projectId: string, start: string, end?: string) {
  const id = uuidv7();
  await w.admin.ok('sprints.create', { id, projectId, startDate: start, endDate: end });
  return id;
}
async function task(projectId: string, statusIdx: number, cycleId: string | null) {
  const a = taskArgs(w, { projectId, statusId: w.statusIds[statusIdx] });
  await w.admin.ok('task.create', a);
  if (cycleId) await w.admin.ok('sprints.setTask', { taskId: a.id, cycleId });
  return a.id;
}
const close = (id: string, nextId = uuidv7()) =>
  w.admin.push('sprints.close', { id, nextId }).then((r) => ({ r, nextId }));

describe('wk2: циклы', () => {
  it('wk2: create — длина по умолчанию 14 дней, номера растут', async () => {
    const p = await project();
    await cfg(p);
    const a = await mk(p, '2026-01-05');
    const b = await mk(p, '2026-01-19', '2026-01-25');
    expect(await cycle(a)).toMatchObject({ number: 1, sd: '2026-01-05', ed: '2026-01-18' });
    expect(await cycle(b)).toMatchObject({ number: 2, ed: '2026-01-25' });
  });

  it('wk2: пересечение дат — conflict', async () => {
    const p = await project();
    await mk(p, '2026-02-01', '2026-02-14');
    const r = await w.admin.push('sprints.create', {
      id: uuidv7(),
      projectId: p,
      startDate: '2026-02-14',
    });
    expect(r).toMatchObject({ ok: false, code: 'conflict' });
    const r2 = await w.admin.push('sprints.create', {
      id: uuidv7(),
      projectId: p,
      startDate: '2026-03-02',
      endDate: '2026-03-01',
    });
    expect(r2).toMatchObject({ ok: false, code: 'invalid_args' });
  });

  it('wk2: update меняет даты, закрытый цикл — conflict', async () => {
    const p = await project();
    const a = await mk(p, '2026-04-01', '2026-04-14');
    await mk(p, '2026-04-15', '2026-04-28');
    expect(await w.admin.push('sprints.update', { id: a, endDate: '2026-04-15' })).toMatchObject({
      ok: false,
      code: 'conflict',
    });
    await w.admin.ok('sprints.update', { id: a, name: 'Первый', endDate: '2026-04-10' });
    expect(await cycle(a)).toMatchObject({ name: 'Первый', ed: '2026-04-10' });
    await w.admin.ok('sprints.close', { id: a, nextId: uuidv7() });
    expect(await w.admin.push('sprints.update', { id: a, name: 'x' })).toMatchObject({
      ok: false,
      code: 'conflict',
    });
  });

  it('wk2: configure — неверный timezone invalid_args, гость не может', async () => {
    const p = await project();
    expect(
      await w.admin.push('sprints.configure', { projectId: p, timezone: 'Mars/Base' }),
    ).toMatchObject({
      ok: false,
      code: 'invalid_args',
    });
    await cfg(p, { timezone: 'Europe/Moscow', lengthDays: 7 });
    expect((await raw('sprints_settings', `where id = '${p}'`))[0]).toMatchObject({
      timezone: 'Europe/Moscow',
      length_days: 7,
      enabled: true,
      auto_create: true,
    });
    expect(await w.guest.push('sprints.configure', { projectId: p, enabled: false })).toMatchObject(
      {
        ok: false,
        code: 'forbidden',
      },
    );
  });

  it('wk2: setTask — чужой проект и закрытый цикл invalid_args', async () => {
    const p1 = await project();
    const p2 = await project();
    const c1 = await mk(p1, '2026-05-01', '2026-05-14');
    const closed = await mk(p1, '2026-06-01', '2026-06-14');
    await w.admin.ok('sprints.close', { id: closed, nextId: uuidv7() });
    const t1 = await task(p1, TODO, null);
    const t2 = await task(p2, TODO, null);
    expect(await w.admin.push('sprints.setTask', { taskId: t2, cycleId: c1 })).toMatchObject({
      ok: false,
      code: 'invalid_args',
    });
    expect(await w.admin.push('sprints.setTask', { taskId: t1, cycleId: closed })).toMatchObject({
      ok: false,
      code: 'invalid_args',
    });
    await w.admin.ok('sprints.setTask', { taskId: t1, cycleId: c1 });
    expect(await taskCycle(t1)).toBe(c1);
    await w.admin.ok('sprints.setTask', { taskId: t1, cycleId: null });
    expect(await taskCycle(t1)).toBeNull();
  });

  it('wk2: смена проекта задачи обнуляет cycleId (ядро)', async () => {
    const p1 = await project();
    const p2 = await project();
    const c = await mk(p1, '2026-07-01', '2026-07-14');
    const t = await task(p1, TODO, c);
    await w.admin.ok('task.update', { id: t, projectId: p2 });
    expect(await taskCycle(t)).toBeNull();
  });

  it('wk2: delete цикла обнуляет cycleId задач', async () => {
    const p = await project();
    const c = await mk(p, '2026-08-01', '2026-08-14');
    const t = await task(p, TODO, c);
    await w.admin.ok('sprints.delete', { id: c });
    expect(await cycle(c)).toBeUndefined();
    expect(await taskCycle(t)).toBeNull();
  });
});

describe('wk2: закрытие цикла', () => {
  it('wk2: close переносит только незакрытые в новый цикл (autoCreate)', async () => {
    const p = await project();
    await cfg(p, { lengthDays: 7 });
    const c = await mk(p, '2026-09-01', '2026-09-14');
    const open = await task(p, TODO, c);
    const backlog = await task(p, BACKLOG, c);
    const done = await task(p, DONE, c);
    const cancelled = await task(p, CANCELLED, c);
    const { nextId } = await close(c);
    expect(await cycle(c)).toMatchObject({ closed_at: expect.anything() });
    expect(await cycle(nextId)).toMatchObject({
      number: 2,
      sd: '2026-09-15',
      ed: '2026-09-21',
      closed_at: null,
    });
    expect(await taskCycle(open)).toBe(nextId);
    expect(await taskCycle(backlog)).toBe(nextId);
    expect(await taskCycle(done)).toBe(c);
    expect(await taskCycle(cancelled)).toBe(c);
  });

  it('wk2: close переносит в ближайший существующий следующий, нового не создаёт', async () => {
    const p = await project();
    const c = await mk(p, '2026-10-01', '2026-10-14');
    await mk(p, '2026-12-01', '2026-12-14');
    const near = await mk(p, '2026-10-20', '2026-10-31');
    const t = await task(p, TODO, c);
    const { nextId } = await close(c);
    expect(await taskCycle(t)).toBe(near);
    expect(await cycle(nextId)).toBeUndefined();
    expect(await cycles(p)).toHaveLength(3);
  });

  it('wk2: autoCreate=false — задачи теряют цикл', async () => {
    const p = await project();
    await cfg(p, { autoCreate: false });
    const c = await mk(p, '2027-01-01', '2027-01-14');
    const t = await task(p, TODO, c);
    await close(c);
    expect(await taskCycle(t)).toBeNull();
    expect(await cycles(p)).toHaveLength(1);
  });

  it('wk2: повторное и параллельное закрытие переносит ровно один раз', async () => {
    const p = await project();
    const c = await mk(p, '2027-02-01', '2027-02-14');
    const t = await task(p, TODO, c);
    const rs = await Promise.all([close(c), close(c), close(c)]);
    for (const { r } of rs) expect(r).toMatchObject({ ok: true });
    const all = await cycles(p);
    expect(all).toHaveLength(2); // исходный + один новый
    const next = all.find((x) => x.id !== c)!;
    expect(await taskCycle(t)).toBe(next.id);
    // задача, добавленная вручную в новый цикл, повторным закрытием не трогается
    await close(c);
    expect(await taskCycle(t)).toBe(next.id);
    expect(await cycles(p)).toHaveLength(2);
  });
});

describe('wk2: cron', () => {
  const job = (queueName: string) =>
    (
      installed.find((m) => m.api.id === 'sprints')!.api.jobs as {
        queue: string;
        cron?: string;
        handler(d: unknown, api: JobApi): Promise<void>;
      }[]
    ).find((j) => j.queue === queueName)!;
  const enqueued: { queue: string; data: unknown; key?: string }[] = [];
  let api: JobApi;
  beforeAll(async () => {
    api = {
      ...(await queue.jobs.api()),
      enqueue: async (q, data, o) => void enqueued.push({ queue: q, data, key: o?.singletonKey }),
    };
  });

  it('wk2: close-due каждые 10 минут; due по часовому поясу проекта', async () => {
    expect(job('sprints.close-due').cron).toBe('*/10 * * * *');
    // разница поясов 25 ч: «сегодня» в Кирибати всегда позже, чем в Паго-Паго
    const behind = todayIn('Pacific/Pago_Pago');
    const ahead = await project();
    const late = await project();
    await cfg(ahead, { timezone: 'Pacific/Kiritimati' });
    await cfg(late, { timezone: 'Pacific/Pago_Pago' });
    const cAhead = await mk(ahead, behind, behind);
    const cLate = await mk(late, behind, behind);
    enqueued.length = 0;
    await job('sprints.close-due').handler({}, api);
    const keys = enqueued.map((e) => e.key);
    expect(keys).toContain(cAhead);
    expect(keys).not.toContain(cLate);
    expect(enqueued.find((e) => e.key === cAhead)).toMatchObject({
      queue: 'sprints.close-cycle',
      data: { cycleId: cAhead },
    });
  });

  it('wk2: close-cycle закрывает просроченный цикл один раз при повторе задачи', async () => {
    const p = await project();
    await cfg(p, { timezone: 'Pacific/Kiritimati' });
    const d = todayIn('Pacific/Pago_Pago');
    const c = await mk(p, d, d);
    const t = await task(p, TODO, c);
    const h = job('sprints.close-cycle').handler;
    await h({ cycleId: c }, api);
    await h({ cycleId: c }, api);
    const all = await cycles(p);
    expect(all).toHaveLength(2);
    expect(all.find((x) => x.id === c)!.closed_at).not.toBeNull();
    expect(await taskCycle(t)).toBe(all.find((x) => x.id !== c)!.id);
  });

  it('wk2: close-cycle не трогает цикл, который ещё не просрочен', async () => {
    const p = await project();
    await cfg(p, { timezone: 'Pacific/Pago_Pago' });
    const d = todayIn('Pacific/Pago_Pago');
    const c = await mk(p, d, d);
    await job('sprints.close-cycle').handler({ cycleId: c }, api);
    expect((await cycle(c))!.closed_at).toBeNull();
  });
});

describe('wk11: гонки и системный пользователь', () => {
  it('wk11: close с 3 клиентов + cron — перенос ровно один раз', async () => {
    const job = (
      installed.find((m) => m.api.id === 'sprints')!.api.jobs as {
        queue: string;
        handler(d: unknown, api: JobApi): Promise<void>;
      }[]
    ).find((j) => j.queue === 'sprints.close-cycle')!;
    const api = await queue.jobs.api();
    for (let i = 0; i < 5; i++) {
      const p = await project();
      await cfg(p, { timezone: 'Pacific/Kiritimati' });
      const d = todayIn('Pacific/Pago_Pago');
      const c = await mk(p, d, d);
      const ts = [await task(p, TODO, c), await task(p, BACKLOG, c), await task(p, DONE, c)];
      const clients = [w.admin, w.member, new TestClient(services(db), w.admin.userId)];
      const rs = await Promise.all([
        ...clients.map((cl) => cl.push('sprints.close', { id: c, nextId: uuidv7() })),
        job.handler({ cycleId: c }, api).catch(() => undefined), // conflict → ретрай pg-boss
      ]);
      for (const r of rs.slice(0, 3))
        expect(r).toSatisfy((x: { ok: boolean; code?: string }) => x.ok || x.code === 'conflict');
      const all = await cycles(p);
      expect(all).toHaveLength(2);
      const next = all.find((x) => x.id !== c)!;
      expect(all.find((x) => x.id === c)!.closed_at).not.toBeNull();
      expect(await taskCycle(ts[0]!)).toBe(next.id);
      expect(await taskCycle(ts[1]!)).toBe(next.id);
      expect(await taskCycle(ts[2]!)).toBe(c);
    }
  }, 120_000);

  const flakyCore = () => {
    const st = { down: true };
    const flaky = new Proxy(db, {
      get: (t, k, r) =>
        k === 'transaction' && st.down
          ? () => Promise.reject(new Error('db down'))
          : Reflect.get(t, k, r),
    });
    const core = new CoreService(flaky);
    core.retryMs = 10;
    return { st, core };
  };

  it('wk11: старт при недоступной БД не падает, systemUserId пока бросает', async () => {
    const { core } = flakyCore();
    await core.onModuleInit();
    expect(() => core.systemUserId()).toThrow();
    core.onModuleDestroy();
  });

  it('wk11: после восстановления БД systemUserId доступен без перезапуска', async () => {
    const { st, core } = flakyCore();
    await core.onModuleInit();
    st.down = false;
    await expect.poll(() => core.systemUserId(), { timeout: 30_000 }).toBeTypeOf('string');
    core.onModuleDestroy();
  });
});
