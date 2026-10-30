import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sprintsCycles } from '@planar/module-sprints/api/schema';
import { apiTokenCreatedSchema, uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import * as schema from '../../src/db/schema.js';
import { moduleTables } from '../../src/modules/installed.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, taskArgs, world, type World } from '../sync/helpers.js';

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let w: World;
let cookies: Record<'admin' | 'member' | 'guest' | 'outsider', string>;
let readToken: string;
let taskA: { id: string; key: string };
let taskB: { id: string; key: string };

const setMods = (ids: string[]) =>
  db
    .insert(schema.settings)
    .values({ id: 'enabled_modules', value: ids })
    .onConflictDoUpdate({ target: schema.settings.id, set: { value: ids } });

type Who = keyof typeof cookies;
const call = (method: string, url: string, who: Who | 'read' = 'admin', payload?: unknown) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: method as 'GET',
      url,
      headers:
        who === 'read'
          ? { authorization: `Bearer ${readToken}` }
          : { cookie: cookies[who], origin: ORIGIN },
      payload: payload as object,
    });
const mkTask = async (title: string) => {
  const id = uuidv7();
  await w.admin.ok('task.create', taskArgs(w, { id, title }));
  const r = await call('GET', `/api/v1/tasks/${id}`);
  return { id, key: r.json().data.key as string };
};

beforeAll(async () => {
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  w = await world(db);
  cookies = {
    admin: await loginCookie(db, w.admin.userId),
    member: await loginCookie(db, w.member.userId),
    guest: await loginCookie(db, w.guest.userId),
    outsider: await loginCookie(db, w.outsider.userId),
  };
  const t = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { cookie: cookies.member, origin: ORIGIN },
      payload: { name: 'r', scope: 'read' },
    });
  readToken = apiTokenCreatedSchema.parse(t.json()).secret;
  await setMods(['time', 'sprints', 'automations']);
  taskA = await mkTask('A');
  taskB = await mkTask('B');
});
beforeEach(() => setMods(['time', 'sprints', 'automations']));
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

describe('wk5: связи', () => {
  let linkId: string;
  it('wk5: POST links по key цели → 201; GET с обеих сторон', async () => {
    const r = await call('POST', `/api/v1/tasks/${taskA.key}/links`, 'member', {
      target: taskB.key,
      kind: 'blocks',
    });
    expect(r.statusCode, r.body).toBe(201);
    linkId = r.json().data.id;
    expect(r.json().data).toMatchObject({ taskId: taskA.id, targetId: taskB.id, kind: 'blocks' });
    for (const t of [taskA.id, taskB.key]) {
      const l = await call('GET', `/api/v1/tasks/${t}/links`, 'guest');
      expect(l.json().data.map((x: { id: string }) => x.id)).toEqual([linkId]);
    }
  });
  it('wk5: повтор пары (и обратная) → 409 conflict; неверный kind → 400', async () => {
    for (const [a, b] of [
      [taskA.id, taskB.id],
      [taskB.id, taskA.id],
    ]) {
      const r = await call('POST', `/api/v1/tasks/${a}/links`, 'admin', {
        target: b,
        kind: 'relates',
      });
      expect(r.statusCode).toBe(409);
      expect(r.json().code).toBe('conflict');
    }
    const bad = await call('POST', `/api/v1/tasks/${taskA.id}/links`, 'admin', {
      target: taskB.id,
      kind: 'x',
    });
    expect(bad.statusCode).toBe(400);
  });
  it('wk5: links — чужой/гость/read-токен', async () => {
    expect((await call('GET', `/api/v1/tasks/${taskA.id}/links`, 'outsider')).statusCode).toBe(404);
    expect(
      (
        await call('POST', `/api/v1/tasks/${taskA.id}/links`, 'outsider', {
          target: taskB.id,
          kind: 'relates',
        })
      ).statusCode,
    ).toBe(404);
    expect((await call('DELETE', `/api/v1/links/${linkId}`, 'outsider')).statusCode).toBe(404);
    expect((await call('GET', `/api/v1/tasks/${taskA.id}/links`, 'read')).statusCode).toBe(200);
    expect((await call('DELETE', `/api/v1/links/${linkId}`, 'read')).statusCode).toBe(403);
  });
  it('wk5: DELETE link → 204, затем 404', async () => {
    expect((await call('DELETE', `/api/v1/links/${linkId}`, 'member')).statusCode).toBe(204);
    expect((await call('DELETE', `/api/v1/links/${linkId}`, 'member')).statusCode).toBe(404);
    expect((await call('GET', `/api/v1/tasks/${taskA.id}/links`)).json().data).toEqual([]);
  });
});

describe('wk5: время и таймер', () => {
  const log = (who: Who, over: object) =>
    call('POST', '/api/v1/time-entries', who, {
      task: taskA.key,
      startedAt: '2026-10-01T09:00:00.000Z',
      durationSec: 600,
      ...over,
    });
  it('wk5: POST time-entries → 201 запись; чужая задача 404; неверное 400', async () => {
    const r = await log('member', { note: 'n' });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json().data).toMatchObject({
      taskId: taskA.id,
      userId: w.member.userId,
      durationSec: 600,
      source: 'manual',
      endedAt: '2026-10-01T09:10:00.000Z',
      note: 'n',
    });
    expect((await log('outsider', {})).statusCode).toBe(404);
    expect((await log('member', { durationSec: 0 })).statusCode).toBe(400);
  });
  it('wk5: time-entries — фильтры userId=me/taskId/from/to и пагинация', async () => {
    await log('member', { startedAt: '2026-10-02T09:00:00.000Z' });
    await log('admin', { task: taskB.id, startedAt: '2026-10-03T09:00:00.000Z' });
    const ids = async (q: string, who: Who = 'member') =>
      (await call('GET', `/api/v1/time-entries?${q}`, who))
        .json()
        .data.map((e: { userId: string; startedAt: string }) => [
          e.userId === w.member.userId,
          e.startedAt.slice(8, 10),
        ]);
    const me = await ids('userId=me');
    expect(me.every((x: [boolean]) => x[0])).toBe(true);
    expect(me.length).toBe(2);
    expect((await ids(`taskId=${taskB.id}`)).length).toBe(1);
    expect((await ids('from=2026-10-02T00:00:00Z&to=2026-10-02T23:59:59Z')).length).toBe(1);
    const p1 = (await call('GET', '/api/v1/time-entries?limit=2', 'member')).json();
    expect(p1.data).toHaveLength(2);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (
      await call('GET', `/api/v1/time-entries?limit=2&cursor=${p1.nextCursor}`, 'member')
    ).json();
    expect(p2.data).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    expect((await call('GET', '/api/v1/time-entries', 'outsider')).json().data).toEqual([]);
    expect((await call('GET', '/api/v1/time-entries?from=вчера', 'member')).statusCode).toBe(400);
  });
  it('wk5: timer — пусто, start (201), второй start останавливает первый, stop, stop без таймера', async () => {
    expect((await call('GET', '/api/v1/timer', 'guest')).json()).toEqual({ data: null });
    expect((await call('POST', '/api/v1/timer/stop', 'guest')).json()).toEqual({ data: null });
    const a = await call('POST', '/api/v1/timer/start', 'member', { task: taskA.key });
    expect(a.statusCode, a.body).toBe(201);
    expect(a.json().data).toMatchObject({ source: 'timer', endedAt: null, taskId: taskA.id });
    expect((await call('GET', '/api/v1/timer', 'member')).json().data.id).toBe(a.json().data.id);
    const b = await call('POST', '/api/v1/timer/start', 'member', { task: taskB.id });
    expect(b.statusCode).toBe(201);
    const list = (
      await call('GET', `/api/v1/time-entries?taskId=${taskA.id}&userId=me`, 'member')
    ).json().data;
    const first = list.find((e: { id: string }) => e.id === a.json().data.id);
    expect(first.endedAt).not.toBeNull();
    expect(first.durationSec).toBeGreaterThanOrEqual(0);
    const stop = await call('POST', '/api/v1/timer/stop', 'member');
    expect(stop.statusCode).toBe(200);
    expect(stop.json().data).toMatchObject({ id: b.json().data.id });
    expect(stop.json().data.endedAt).not.toBeNull();
    expect((await call('GET', '/api/v1/timer', 'member')).json()).toEqual({ data: null });
  });
  it('wk5: timer start — чужая задача 404, read-токен 403', async () => {
    expect(
      (await call('POST', '/api/v1/timer/start', 'outsider', { task: taskA.id })).statusCode,
    ).toBe(404);
    expect((await call('POST', '/api/v1/timer/start', 'read', { task: taskA.id })).statusCode).toBe(
      403,
    );
    expect((await call('GET', '/api/v1/timer', 'read')).statusCode).toBe(200);
  });
});

describe('wk5: циклы', () => {
  const day = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
  const row = (n: number, start: string, end: string, closed: string | null) => ({
    id: uuidv7(),
    spaceId: w.spaceId,
    projectId: w.projectId,
    number: n,
    startDate: start,
    endDate: end,
    closedAt: closed,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  it('wk5: cycles/current → null без текущего; невидимый проект 404', async () => {
    const url = `/api/v1/projects/${w.projectId}/cycles`;
    expect((await call('GET', url, 'member')).json()).toEqual({ data: [] });
    expect((await call('GET', `${url}/current`, 'member')).json()).toEqual({ data: null });
    expect((await call('GET', url, 'outsider')).statusCode).toBe(404);
    expect((await call('GET', `${url}/current`, 'outsider')).statusCode).toBe(404);
    expect((await call('GET', '/api/v1/projects/x/cycles', 'member')).statusCode).toBe(404);
  });
  it('wk5: cycles — по number убыв.; current — открытый с сегодняшней датой', async () => {
    const old = row(1, day(-30), day(-20), day(-20));
    const cur = row(2, day(-1), day(5), null);
    const next = row(3, day(6), day(12), null);
    await db.insert(sprintsCycles).values([old, cur, next]);
    const url = `/api/v1/projects/${w.projectId}/cycles`;
    const all = (await call('GET', url, 'guest')).json().data;
    expect(all.map((c: { number: number }) => c.number)).toEqual([3, 2, 1]);
    expect(all[0].startDate).toBe(next.startDate);
    expect((await call('GET', `${url}/current`, 'guest')).json().data.id).toBe(cur.id);
  });
});

describe('wk5: автоматизации', () => {
  const rules = moduleTables().get('automationsRules')!;
  it('wk5: правила проекта на чтение; невидимый проект 404', async () => {
    const id = uuidv7();
    await db.insert(rules).values({
      id,
      spaceId: w.spaceId,
      projectId: w.projectId,
      name: 'R',
      enabled: true,
      trigger: { type: 'task.created' },
      conditions: { op: 'and', rules: [] },
      actions: [],
      createdBy: w.admin.userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as never);
    const url = `/api/v1/projects/${w.projectId}/automations`;
    expect((await call('GET', url, 'guest')).json().data.map((r: { id: string }) => r.id)).toEqual([
      id,
    ]);
    expect((await call('GET', url, 'outsider')).statusCode).toBe(404);
  });
});

describe('wk5: выключенный модуль → 404 module_disabled', () => {
  it('wk5: все пути модулей', async () => {
    await setMods([]);
    const p = `/api/v1/projects/${w.projectId}`;
    const reqs: [string, string, object?][] = [
      ['GET', '/api/v1/time-entries'],
      [
        'POST',
        '/api/v1/time-entries',
        { task: taskA.id, startedAt: '2026-10-01T09:00:00Z', durationSec: 60 },
      ],
      ['GET', '/api/v1/timer'],
      ['POST', '/api/v1/timer/start', { task: taskA.id }],
      ['POST', '/api/v1/timer/stop'],
      ['GET', `${p}/cycles`],
      ['GET', `${p}/cycles/current`],
      ['GET', `${p}/automations`],
    ];
    for (const [m, u, b] of reqs) {
      const r = await call(m, u, 'member', b);
      expect([m, u, r.statusCode, r.json().code]).toEqual([m, u, 404, 'module_disabled']);
    }
    // links are the core, they work without modules
    expect((await call('GET', `/api/v1/tasks/${taskA.id}/links`)).statusCode).toBe(200);
  });
});

describe('wk5: openapi', () => {
  it('wk5: новые пути и схемы в openapi.json', async () => {
    const d = (await call('GET', '/api/v1/openapi.json', 'member')).json();
    for (const p of [
      '/api/v1/tasks/{task}/links',
      '/api/v1/links/{id}',
      '/api/v1/time-entries',
      '/api/v1/timer',
      '/api/v1/timer/start',
      '/api/v1/timer/stop',
      '/api/v1/projects/{id}/cycles',
      '/api/v1/projects/{id}/cycles/current',
      '/api/v1/projects/{id}/automations',
    ])
      expect(d.paths[p], p).toBeTruthy();
    expect(d.components.schemas.TimeEntry.properties.durationSec).toBeTruthy();
    expect(d.components.schemas.Cycle.properties.number).toBeTruthy();
  });
});
