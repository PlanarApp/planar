import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import * as schema from '../../src/db/schema.js';
import type { JobApi } from '../../src/modules/hooks.js';
import { installed } from '../../src/modules/installed.js';
import { PushQueue } from '../../src/push/push.js';
import { dbUrl, key, newDb, taskArgs, world, type World } from '../sync/helpers.js';

const db = newDb();
const queue = new PushQueue(db, { boss: false, databaseUrl: dbUrl });
let w: World;
let api: JobApi;
let sys: string;
const enq: { queue: string; data: Record<string, unknown>; key?: string }[] = [];

beforeAll(async () => {
  w = await world(db);
  await db
    .insert(schema.settings)
    .values({ id: 'enabled_modules', value: ['recurring'] })
    .onConflictDoUpdate({ target: schema.settings.id, set: { value: ['recurring'] } });
  api = {
    ...(await queue.jobs.api()),
    enqueue: async (q, data, o) =>
      void enq.push({ queue: q, data: data as Record<string, unknown>, key: o?.singletonKey }),
  };
  sys = api.systemUserId;
});
afterAll(async () => {
  await queue.onApplicationShutdown();
  await db.$client.end();
});

const job = (q: string) =>
  (
    installed.find((m) => m.api.id === 'recurring')!.api.jobs as {
      queue: string;
      cron?: string;
      handler(d: unknown, api: JobApi): Promise<void>;
    }[]
  ).find((j) => j.queue === q)!;
const raw = (sqlText: string, args: unknown[] = []) =>
  db.$client.query(sqlText, args).then((r) => r.rows);
const rule = async (taskId: string) =>
  (
    await raw(
      'select *, next_date::text as nd, anchor_date::text as ad from recurring_rules where task_id = $1',
      [taskId],
    )
  )[0];
const todayUtc = () => new Date().toISOString().slice(0, 10);
const plus = (d: string, n: number) =>
  new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);

async function project() {
  const id = uuidv7();
  await w.admin.ok('project.create', { id, spaceId: w.spaceId, name: 'P', key: key(), rank: 'a0' });
  return id;
}
async function task(over: Record<string, unknown> = {}) {
  const a = taskArgs(w, over);
  await w.admin.ok('task.create', a);
  return a.id;
}
const set = (taskId: string, over: Record<string, unknown> = {}) => {
  const id = uuidv7();
  return w.admin
    .push('recurring.set', {
      id,
      taskId,
      kind: 'interval',
      every: 1,
      unit: 'day',
      weekdays: [],
      timezone: 'UTC',
      ...over,
    })
    .then((r) => ({ r, id }));
};
const instances = (title: string) =>
  raw(
    `select id, created_by, due_date::text as dd, start_date::text as sd, status_id, fields, priority from tasks where title = $1 order by created_at`,
    [title],
  );

describe('pf1: мутаторы', () => {
  it('pf1: set — nextDate от dueDate, anchorDate по умолчанию, одно правило на задачу', async () => {
    const t = await task({ dueDate: '2026-03-10' });
    const { r, id } = await set(t, { every: 2 });
    expect(r).toMatchObject({ ok: true });
    expect(await rule(t)).toMatchObject({
      id,
      ad: '2026-03-10',
      nd: '2026-03-12',
      created_by: w.admin.userId,
    });
    // другой id для той же задачи — обновляется существующее
    const again = await set(t, { kind: 'after_done', every: 3 });
    expect(again.r).toMatchObject({ ok: true });
    const all = await raw('select * from recurring_rules where task_id = $1', [t]);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id, kind: 'after_done', every: 3, next_date: null });
  });

  it('pf1: set — неверные поля invalid_args, нет задачи not_found', async () => {
    const t = await task();
    for (const bad of [
      { every: 0 },
      { every: 366 },
      { timezone: 'Mars/Base' },
      { kind: 'weekdays', unit: 'week', weekdays: [] },
      { kind: 'weekdays', unit: 'day', weekdays: [1] },
      { kind: 'weekdays', unit: 'week', weekdays: [3, 1] },
      { kind: 'weekdays', unit: 'week', weekdays: [7] },
      { kind: 'weekdays', unit: 'week', every: 53, weekdays: [1] },
      { weekdays: [1] },
    ])
      expect((await set(t, bad)).r, JSON.stringify(bad)).toMatchObject({
        ok: false,
        code: 'invalid_args',
      });
    expect((await set(uuidv7())).r).toMatchObject({ ok: false, code: 'not_found' });
    expect(await rule(t)).toBeUndefined();
  });

  it('pf1: advance только от системы; remove снимает правило; гость не пишет', async () => {
    const t = await task({ dueDate: '2026-03-10' });
    const { id } = await set(t);
    expect(
      await w.admin.push('recurring.advance', { id, taskId: t, nextDate: null }),
    ).toMatchObject({ ok: false, code: 'forbidden' });
    expect(
      await w.guest.push('recurring.set', {
        id: uuidv7(),
        taskId: t,
        kind: 'interval',
        every: 1,
        unit: 'day',
        weekdays: [],
        timezone: 'UTC',
      }),
    ).toMatchObject({ ok: false });
    await w.admin.ok('recurring.remove', { taskId: t });
    expect(await rule(t)).toBeUndefined();
    await w.admin.ok('recurring.remove', { taskId: t }); // нет правила — ничего
  });
});

describe('pf1: экземпляры', () => {
  async function sample() {
    const p = await project();
    const title = `R-${uuidv7()}`;
    const due = plus(todayUtc(), -1);
    const label = uuidv7();
    await w.admin.ok('label.create', {
      id: label,
      spaceId: w.spaceId,
      name: title.slice(0, 20),
      color: '#fff',
    });
    const t = await task({
      projectId: p,
      title,
      priority: 3,
      dueDate: due,
      startDate: plus(due, -2),
      assignees: [
        { id: uuidv7(), userId: w.admin.userId },
        { id: uuidv7(), userId: w.member.userId },
      ],
      labels: [{ id: uuidv7(), labelId: label }],
    });
    const f = uuidv7();
    await w.admin.ok('field.create', { id: f, projectId: p, name: 'F', type: 'text', rank: 'a0' });
    await w.admin.ok('task.update', { id: t, fields: { [f]: 'v' } });
    await w.admin.ok('checklist.add', { id: uuidv7(), taskId: t, text: 'один', rank: 'a0' });
    await w.admin.ok('checklist.add', { id: uuidv7(), taskId: t, text: 'два', rank: 'a1' });
    return { p, title, t, due, label, f };
  }

  it('pf1: tick ставит spawn с singletonKey; два tick и параллельный spawn — один экземпляр', async () => {
    expect(job('recurring.tick').cron).toBe('*/10 * * * *');
    const s = await sample();
    const { id } = await set(s.t, { anchorDate: s.due }); // nextDate = завтра
    // сдвигаем nextDate на «вчера» через advance от системы
    await api.execute(
      sys,
      [{ name: 'recurring.advance', args: { id, taskId: s.t, nextDate: s.due } }],
      {
        system: true,
      },
    );
    enq.length = 0;
    await job('recurring.tick').handler({}, api);
    await job('recurring.tick').handler({}, api);
    const mine = enq.filter((e) => e.data.ruleId === id);
    expect(mine).toHaveLength(2);
    const per = plus(todayUtc(), 2); // span образца 2 дня: экземпляр создаётся заранее
    expect(mine[0]).toMatchObject({
      queue: 'recurring.spawn',
      key: `${id}:${per}`,
      data: { period: per, taskId: s.t },
    });
    // воркеры: параллельно + повтор
    await Promise.all([1, 2, 3].map(() => job('recurring.spawn').handler(mine[0]!.data, api)));
    await job('recurring.spawn').handler(mine[1]!.data, api);
    const all = await instances(s.title);
    expect(all).toHaveLength(2);
    const r = await rule(all[1]!.id);
    expect(r).toMatchObject({ id, nd: plus(per, 1) });
    expect(await raw('select * from recurring_runs where rule_id = $1', [id])).toHaveLength(1);
  });

  it('pf1: копия полей, исполнителей, меток и чек-листа; автор — система', async () => {
    const s = await sample();
    const { id } = await set(s.t, { anchorDate: s.due });
    await api.execute(
      sys,
      [{ name: 'recurring.advance', args: { id, taskId: s.t, nextDate: s.due } }],
      {
        system: true,
      },
    );
    await job('recurring.spawn').handler({ ruleId: id, period: s.due, taskId: s.t }, api);
    const [, n] = await instances(s.title);
    expect(n).toMatchObject({
      created_by: sys,
      dd: s.due,
      sd: plus(s.due, -2),
      priority: 3,
      fields: { [s.f]: 'v' },
    });
    expect(n!.status_id).toBe(w.statusIds[1]); // первый todo
    const as = await raw('select user_id from task_assignees where task_id = $1', [n!.id]);
    expect(as.map((x) => x.user_id).sort()).toEqual([w.admin.userId, w.member.userId].sort());
    expect(await raw('select label_id from task_labels where task_id = $1', [n!.id])).toEqual([
      { label_id: s.label },
    ]);
    const cl = await raw(
      'select text, rank, done from checklist_items where task_id = $1 order by rank',
      [n!.id],
    );
    expect(cl).toEqual([
      { text: 'один', rank: 'a0', done: false },
      { text: 'два', rank: 'a1', done: false },
    ]);
  });

  it('pf1: spawn со старым taskId (правило уже ушло дальше) ничего не создаёт', async () => {
    const s = await sample();
    const { id } = await set(s.t, { anchorDate: s.due });
    await api.execute(
      sys,
      [{ name: 'recurring.advance', args: { id, taskId: s.t, nextDate: s.due } }],
      {
        system: true,
      },
    );
    await job('recurring.spawn').handler({ ruleId: id, period: s.due, taskId: s.t }, api);
    await job('recurring.spawn').handler({ ruleId: id, period: plus(s.due, 1), taskId: s.t }, api);
    expect(await instances(s.title)).toHaveLength(2);
    await job('recurring.spawn').handler({ ruleId: uuidv7(), period: s.due }, api); // правила нет
  });

  it('pf1: исполнитель, вышедший из пространства, и без дат образца — только dueDate', async () => {
    const p = await project();
    const title = `R-${uuidv7()}`;
    const t = await task({
      projectId: p,
      title,
      assignees: [{ id: uuidv7(), userId: w.outsider.userId }],
    });
    const { id } = await set(t, { anchorDate: todayUtc() });
    await api.execute(
      sys,
      [{ name: 'recurring.advance', args: { id, taskId: t, nextDate: todayUtc() } }],
      {
        system: true,
      },
    );
    await job('recurring.spawn').handler({ ruleId: id, period: todayUtc(), taskId: t }, api);
    const [, n] = await instances(title);
    expect(n).toMatchObject({ dd: todayUtc(), sd: null });
    expect(await raw('select 1 from task_assignees where task_id = $1', [n!.id])).toHaveLength(0);
  });
});
