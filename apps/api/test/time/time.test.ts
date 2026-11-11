import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATA_MODULE_IDS, uuidv7 } from '@planar/shared';
import { timeEntries, timeEstimates } from '@planar/module-time/api/schema';
import * as schema from '../../src/db/schema.js';
import {
  mkUser,
  newDb,
  TestClient,
  services,
  taskArgs,
  world,
  type World,
} from '../sync/helpers.js';

const db = newDb();
let w: World;
let taskId: string;
let sub: string;

const entries = (userId: string) =>
  db.select().from(timeEntries).where(eq(timeEntries.userId, userId));
const entry = async (id: string) =>
  (await db.select().from(timeEntries).where(eq(timeEntries.id, id)))[0];
const iso = (v: string) => new Date(v).toISOString();
const start = (c: TestClient, id = uuidv7(), t = taskId, extra = {}) =>
  c.push('time.start', { id, taskId: t, ...extra }).then((r) => ({ r, id }));

beforeAll(async () => {
  w = await world(db);
  taskId = uuidv7();
  sub = uuidv7();
  await w.admin.ok('task.create', taskArgs(w, { id: taskId }));
  await w.admin.ok('task.create', taskArgs(w, { id: sub, parentId: taskId }));
});
afterAll(() => db.$client.end());

describe('wk1: time', () => {
  it('wk1: start создаёт идущую запись с серверным startedAt', async () => {
    const { r, id } = await start(w.member, undefined, taskId, {
      startedAt: '2000-01-01T00:00:00Z',
    });
    expect(r).toMatchObject({ ok: true });
    const e = await entry(id);
    expect(e).toMatchObject({ userId: w.member.userId, source: 'timer', endedAt: null });
    expect(e.durationSec).toBeNull();
    expect(Date.now() - Date.parse(e.startedAt)).toBeLessThan(60_000);
    await w.member.ok('time.stop', { id });
  });

  it('wk1: новый start останавливает прежний', async () => {
    const a = await start(w.member);
    await new Promise((r) => setTimeout(r, 1100));
    const b = await start(w.member, undefined, sub);
    expect(b.r).toMatchObject({ ok: true });
    const ea = await entry(a.id);
    expect(ea.endedAt).not.toBeNull();
    expect(ea.durationSec).toBeGreaterThanOrEqual(1);
    expect((await entry(b.id)).endedAt).toBeNull();
    expect((await entries(w.member.userId)).filter((e) => !e.endedAt)).toHaveLength(1);
    await w.member.ok('time.stop', { id: b.id });
  });

  it('wk1: гонка двух start — второй читает до коммита первого и получает conflict', async () => {
    const user = await mkUser(db, 'member');
    await w.admin.ok('member.add', {
      id: uuidv7(),
      spaceId: w.spaceId,
      userId: user,
      role: 'member',
    });
    const c = new TestClient(services(db), user);
    // "first transaction": the ongoing write is inserted but not committed
    const raw = await db.$client.connect();
    const first = uuidv7();
    await raw.query('begin');
    await raw.query(
      `insert into time_entries (id, space_id, task_id, user_id, started_at, source, created_at, updated_at)
       values ($1, $2, $3, $4, now(), 'timer', now(), now())`,
      [first, w.spaceId, taskId, user],
    );
    // the second does not see it (read committed), inserts, and waits on the unique index
    const second = start(c);
    for (let i = 0; i < 100; i++) {
      const r = await db.$client.query(
        "select 1 from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()",
      );
      if (r.rowCount) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await raw.query('commit');
    raw.release();
    expect((await second).r).toMatchObject({ ok: false, code: 'conflict' });
    const rows = await entries(user);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(first);
  });

  it('wk1: stop считает durationSec по серверному времени', async () => {
    const { id } = await start(w.admin);
    // the client's age does not matter: we edit startedAt in the DB back by 90 s
    const back = new Date(Date.now() - 90_000).toISOString();
    await db.update(timeEntries).set({ startedAt: back }).where(eq(timeEntries.id, id));
    await w.admin.ok('time.stop', { id });
    const e = await entry(id);
    expect(e.endedAt).not.toBeNull();
    expect(e.durationSec).toBeGreaterThanOrEqual(90);
    expect(e.durationSec).toBeLessThan(120);
    expect(e.durationSec).toBe(
      Math.floor((Date.parse(e.endedAt!) - Date.parse(e.startedAt)) / 1000),
    );
    // repeated stop — nothing
    await w.admin.ok('time.stop', { id });
    expect((await entry(id)).endedAt).toBe(e.endedAt);
  });

  it('wk1: log — ручная запись, endedAt = startedAt + durationSec', async () => {
    const id = uuidv7();
    await w.member.ok('time.log', {
      id,
      taskId,
      startedAt: '2026-10-20T09:00:00.000Z',
      durationSec: 5400,
      note: 'ревью',
    });
    const e = await entry(id);
    expect(iso(e.endedAt!)).toBe('2026-10-20T10:30:00.000Z');
    expect(e).toMatchObject({ durationSec: 5400, source: 'manual', note: 'ревью' });
    expect(
      await w.member.push('time.log', {
        id: uuidv7(),
        taskId,
        startedAt: iso(e.startedAt),
        durationSec: 0,
      }),
    ).toMatchObject({ code: 'invalid_args' });
    expect(
      await w.member.push('time.log', {
        id: uuidv7(),
        taskId,
        startedAt: iso(e.startedAt),
        durationSec: 86401,
      }),
    ).toMatchObject({ code: 'invalid_args' });
  });

  it('wk1: update пересчитывает endedAt/durationSec; endedAt < startedAt — invalid_args', async () => {
    const id = uuidv7();
    await w.member.ok('time.log', {
      id,
      taskId,
      startedAt: '2026-10-20T09:00:00.000Z',
      durationSec: 600,
    });
    await w.member.ok('time.update', { id, durationSec: 1200 });
    expect(iso((await entry(id)).endedAt!)).toBe('2026-10-20T09:20:00.000Z');
    await w.member.ok('time.update', { id, startedAt: '2026-10-20T08:00:00.000Z' });
    expect(await entry(id)).toMatchObject({ durationSec: 4800 });
    await w.member.ok('time.update', { id, endedAt: '2026-10-20T08:10:00.000Z', note: 'x' });
    expect(await entry(id)).toMatchObject({ durationSec: 600, note: 'x' });
    expect(
      await w.member.push('time.update', { id, endedAt: '2026-10-20T07:00:00.000Z' }),
    ).toMatchObject({ ok: false, code: 'invalid_args' });
    expect((await entry(id)).durationSec).toBe(600);
  });

  it('PLNRAPP-145: billable — по умолчанию false, задаётся в log и правится в update', async () => {
    const [a, b] = [uuidv7(), uuidv7()];
    const at = '2026-10-20T09:00:00.000Z';
    await w.member.ok('time.log', { id: a, taskId, startedAt: at, durationSec: 600 });
    await w.member.ok('time.log', {
      id: b,
      taskId,
      startedAt: at,
      durationSec: 600,
      billable: true,
    });
    expect(await entry(a)).toMatchObject({ billable: false });
    expect(await entry(b)).toMatchObject({ billable: true });
    await w.member.ok('time.update', { id: a, billable: true });
    expect(await entry(a)).toMatchObject({ billable: true, durationSec: 600 });
  });

  it('wk1: у идущей записи правятся только startedAt и note', async () => {
    const { id } = await start(w.member);
    expect(await w.member.push('time.update', { id, durationSec: 10 })).toMatchObject({
      code: 'invalid_args',
    });
    await w.member.ok('time.update', { id, note: 'идёт' });
    expect(await entry(id)).toMatchObject({ note: 'идёт', endedAt: null });
    await w.member.ok('time.stop', { id });
  });

  it('wk1: update/delete/stop чужой записи — forbidden', async () => {
    const id = uuidv7();
    await w.member.ok('time.log', {
      id,
      taskId,
      startedAt: '2026-10-20T09:00:00.000Z',
      durationSec: 60,
    });
    for (const [n, a] of [
      ['time.update', { id, note: 'x' }],
      ['time.delete', { id }],
      ['time.stop', { id }],
    ] as const)
      expect(await w.admin.push(n, a), n).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await entry(id)).toBeDefined();
    await w.member.ok('time.delete', { id });
    expect(await entry(id)).toBeUndefined();
  });

  it('wk1: setEstimate — put, замена, null удаляет; диапазон проверяется', async () => {
    const get = async () =>
      (await db.select().from(timeEstimates).where(eq(timeEstimates.taskId, taskId)))[0];
    await w.member.ok('time.setEstimate', { taskId, minutes: 90 });
    expect(await get()).toMatchObject({ id: taskId, minutes: 90, updatedBy: w.member.userId });
    await w.admin.ok('time.setEstimate', { taskId, minutes: 120 });
    expect(await get()).toMatchObject({ minutes: 120, updatedBy: w.admin.userId });
    for (const minutes of [0, 100001, 1.5])
      expect(await w.admin.push('time.setEstimate', { taskId, minutes })).toMatchObject({
        code: 'invalid_args',
      });
    await w.admin.ok('time.setEstimate', { taskId, minutes: null });
    expect(await get()).toBeUndefined();
  });

  it('wk1: удаление задачи удаляет записи и оценку (и подзадач)', async () => {
    const t = uuidv7();
    const s = uuidv7();
    await w.admin.ok('task.create', taskArgs(w, { id: t }));
    await w.admin.ok('task.create', taskArgs(w, { id: s, parentId: t }));
    const keep = uuidv7();
    await w.member.ok('time.log', {
      id: keep,
      taskId,
      startedAt: '2026-10-20T09:00:00.000Z',
      durationSec: 60,
    });
    const [e1, e2] = [uuidv7(), uuidv7()];
    await w.member.ok('time.log', {
      id: e1,
      taskId: t,
      startedAt: '2026-10-20T09:00:00.000Z',
      durationSec: 60,
    });
    await w.admin.ok('time.log', {
      id: e2,
      taskId: s,
      startedAt: '2026-10-20T09:00:00.000Z',
      durationSec: 60,
    });
    await w.admin.ok('time.setEstimate', { taskId: t, minutes: 30 });
    await w.admin.ok('time.setEstimate', { taskId: s, minutes: 30 });
    await w.admin.ok('task.delete', { id: t });
    expect(await entry(e1)).toBeUndefined();
    expect(await entry(e2)).toBeUndefined();
    expect(
      await db
        .select()
        .from(timeEstimates)
        .where(eq(timeEstimates.spaceId, w.spaceId))
        .then((r) => r.filter((x) => [t, s].includes(x.taskId))),
    ).toHaveLength(0);
    expect(await entry(keep)).toBeDefined();
  });

  it('PLNRAPP-117: слияние задачи переносит её записи времени в целевую', async () => {
    const [a, b, e1] = [uuidv7(), uuidv7(), uuidv7()];
    await w.admin.ok('task.create', taskArgs(w, { id: a }));
    await w.admin.ok('task.create', taskArgs(w, { id: b }));
    await w.member.ok('time.log', {
      id: e1,
      taskId: b,
      startedAt: '2026-10-20T09:00:00.000Z',
      durationSec: 60,
    });
    await w.member.ok('task.merge', { id: b, targetId: a, linkId: uuidv7() });
    expect(await entry(e1)).toMatchObject({ taskId: a, userId: w.member.userId });
  });

  it('wk1: guest не пишет — forbidden', async () => {
    for (const [n, a] of [
      ['time.start', { id: uuidv7(), taskId }],
      [
        'time.log',
        { id: uuidv7(), taskId, startedAt: '2026-10-20T09:00:00.000Z', durationSec: 60 },
      ],
      ['time.setEstimate', { taskId, minutes: 5 }],
    ] as const)
      expect(await w.guest.push(n, a), n).toMatchObject({ ok: false, code: 'forbidden' });
  });

  it('wk1: start/log по неизвестной задаче — not_found, чужой id — conflict', async () => {
    expect(await w.member.push('time.start', { id: uuidv7(), taskId: uuidv7() })).toMatchObject({
      code: 'not_found',
    });
    const id = uuidv7();
    await w.member.ok('time.log', {
      id,
      taskId,
      startedAt: '2026-10-20T09:00:00.000Z',
      durationSec: 60,
    });
    expect(
      await w.admin.push('time.log', {
        id,
        taskId,
        startedAt: '2026-10-20T09:00:00.000Z',
        durationSec: 60,
      }),
    ).toMatchObject({ ok: false, code: 'conflict' });
    expect((await entry(id)).userId).toBe(w.member.userId);
  });

  it('wk1: записи приходят в bootstrap включённого модуля', async () => {
    const boot = await w.member.bootstrap();
    expect(boot.data).toHaveProperty('timeEntries');
    expect(boot.data).toHaveProperty('timeEstimates');
  });

  it('PJ-3 wk1: модуль выключен в проекте — мутаторы conflict module_disabled, строки остаются видимыми', async () => {
    const set = (modules: string[]) =>
      db.update(schema.projects).set({ modules }).where(eq(schema.projects.id, w.projectId));
    await set([]);
    try {
      expect(await w.member.push('time.start', { id: uuidv7(), taskId })).toMatchObject({
        ok: false,
        code: 'conflict',
        message: expect.stringContaining('module_disabled'),
      });
      expect((await w.member.bootstrap()).data).toHaveProperty('timeEntries');
    } finally {
      await set([...DATA_MODULE_IDS]);
    }
  });
});
