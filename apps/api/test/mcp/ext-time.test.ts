import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiTokenCreatedSchema } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { toolDefs } from '../../src/mcp/tools.js';
import { area } from '../../src/rest/ext/time.js';
import { RestService } from '../../src/rest/rest.service.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, world, type World } from '../sync/helpers.js';

// PLNRAPP-275 (TM-1): time entries, estimates, report, workload capacity and recurring rules over REST v1
const PARITY_TIME: Record<string, string> = {
  'PATCH /api/v1/time-entries/{id}': 'update_time_entry',
  'DELETE /api/v1/time-entries/{id}': 'delete_time_entry',
  'PUT /api/v1/tasks/{task}/estimate': 'set_task_estimate',
  'GET /api/v1/time-report': 'time_report',
  'GET /api/v1/spaces/{id}/workload': 'get_workload',
  'PUT /api/v1/spaces/{id}/workload/{userId}': 'set_workload_capacity',
  'GET /api/v1/tasks/{task}/recurring': 'get_recurring',
  'PUT /api/v1/tasks/{task}/recurring': 'set_recurring',
  'DELETE /api/v1/tasks/{task}/recurring': 'remove_recurring',
};

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let w: World;
let admin: string;
let member: string;
let read: string;
let outsider: string;

async function issue(userId: string, scope: 'read' | 'write') {
  const r = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { cookie: await loginCookie(db, userId), origin: ORIGIN },
      payload: { name: 't', scope },
    });
  return apiTokenCreatedSchema.parse(r.json()).secret;
}

beforeAll(async () => {
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN });
  await app.listen(0, '127.0.0.1');
  w = await world(db);
  admin = await issue(w.admin.userId, 'write');
  member = await issue(w.member.userId, 'write');
  read = await issue(w.admin.userId, 'read');
  outsider = await issue(w.outsider.userId, 'write');
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

const rest = async (secret: string, method: string, url: string, payload?: object) => {
  const r = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: method as 'GET',
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${secret}` },
      payload,
    });
  return [r.statusCode, r.body ? r.json() : null] as const;
};

describe('время, нагрузка, повторяющиеся (ext/time)', () => {
  it('PARITY_TIME равен операциям области; удаления — danger delete', () => {
    expect(
      Object.fromEntries(area.ops.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o.tool])),
    ).toEqual(PARITY_TIME);
    const defs = toolDefs(app.get(RestService));
    for (const o of area.ops) {
      const d = defs.find((x) => x.name === o.tool);
      expect(d?.write, o.tool).toBe(o.write);
      expect(d?.danger, o.tool).toBe(o.method === 'delete' ? 'delete' : undefined);
    }
  });

  it('запись времени: изменить, отчёт, оценка, удалить; чужую не тронуть', async () => {
    const [, t] = await rest(admin, 'POST', '/tasks', { projectId: w.projectId, title: 'T' });
    const task = t.data.id as string;
    const [, e] = await rest(admin, 'POST', '/time-entries', {
      task,
      startedAt: '2026-01-01T10:00:00Z',
      durationSec: 600,
    });
    const eid = e.data.id as string;
    const [s1, u] = await rest(admin, 'PATCH', `/time-entries/${eid}`, {
      durationSec: 1200,
      note: 'n',
      billable: true,
    });
    expect([s1, u.data.durationSec, u.data.note, u.data.billable]).toEqual([200, 1200, 'n', true]);
    const [s2, rep] = await rest(
      admin,
      'GET',
      `/time-report?projectId=${w.projectId}&groupBy=task&from=2026-01-01T00:00:00Z`,
    );
    expect(s2).toBe(200);
    expect(rep.data).toEqual([{ key: task, entries: 1, durationSec: 1200, billableSec: 1200 }]);
    expect((await rest(admin, 'GET', `/time-report?projectId=${w.projectId}`))[1].data[0].key).toBe(
      w.admin.userId,
    );
    expect((await rest(member, 'PATCH', `/time-entries/${eid}`, { note: 'x' }))[0]).toBe(403);
    expect((await rest(member, 'DELETE', `/time-entries/${eid}`))[0]).toBe(403);

    const [s3, est] = await rest(admin, 'PUT', `/tasks/${task}/estimate`, { minutes: 90 });
    expect([s3, est.data.estimate.minutes]).toEqual([200, 90]);
    expect(
      (await rest(admin, 'PUT', `/tasks/${task}/estimate`, { minutes: null }))[1].data.estimate,
    ).toBeNull();

    expect((await rest(admin, 'DELETE', `/time-entries/${eid}`))[0]).toBe(204);
    expect((await rest(admin, 'DELETE', `/time-entries/${eid}`))[0]).toBe(404);
  });

  it('ёмкость: чтение всем участникам, запись — админу пространства', async () => {
    const [s0, list] = await rest(member, 'GET', `/spaces/${w.spaceId}/workload`);
    expect(s0).toBe(200);
    expect(list.data.map((m: { hoursPerWeek: number | null }) => m.hoursPerWeek)).toEqual([
      null,
      null,
      null,
    ]);
    const url = `/spaces/${w.spaceId}/workload/${w.member.userId}`;
    const [s1, c] = await rest(admin, 'PUT', url, { hoursPerWeek: 30 });
    expect([s1, c.data.hoursPerWeek]).toEqual([200, 30]);
    expect((await rest(member, 'PUT', url, { hoursPerWeek: 1 }))[0]).toBe(403);
    expect((await rest(admin, 'PUT', url, { hoursPerWeek: null }))[1].data.hoursPerWeek).toBeNull();
  });

  it('повтор: задать → прочитать → заменить → снять; неверное расписание — 400', async () => {
    const [, t] = await rest(admin, 'POST', '/tasks', { projectId: w.projectId, title: 'R' });
    const url = `/tasks/${t.data.key}/recurring`;
    expect((await rest(admin, 'GET', url))[1].data).toBeNull();
    const [s1, r1] = await rest(admin, 'PUT', url, {
      kind: 'interval',
      every: 2,
      unit: 'week',
      anchorDate: '2026-01-05',
    });
    expect([s1, r1.data.kind, r1.data.every, r1.data.nextDate]).toEqual([
      200,
      'interval',
      2,
      '2026-01-19',
    ]);
    const [, r2] = await rest(admin, 'PUT', url, {
      kind: 'weekdays',
      every: 1,
      unit: 'week',
      weekdays: [1, 3],
      anchorDate: '2026-01-05',
    });
    expect([r2.data.id, r2.data.weekdays]).toEqual([r1.data.id, [1, 3]]);
    expect((await rest(admin, 'PUT', url, { kind: 'weekdays', every: 1, unit: 'week' }))[0]).toBe(
      400,
    );
    expect((await rest(admin, 'DELETE', url))[0]).toBe(204);
    expect((await rest(admin, 'GET', url))[1].data).toBeNull();
  });

  it('модуль выключен — 404; чужой — 404; токен read — 403', async () => {
    const [, t] = await rest(admin, 'POST', '/tasks', { projectId: w.projectId, title: 'O' });
    const task = t.data.id as string;
    const [, e] = await rest(admin, 'POST', '/time-entries', {
      task,
      startedAt: '2026-01-01T10:00:00Z',
      durationSec: 60,
    });
    for (const [m, u, b] of [
      ['PATCH', `/time-entries/${e.data.id}`, { note: 'x' }],
      ['DELETE', `/time-entries/${e.data.id}`],
      ['PUT', `/tasks/${task}/estimate`, { minutes: 5 }],
      ['GET', `/time-report?projectId=${w.projectId}`],
      ['GET', `/spaces/${w.spaceId}/workload`],
      ['PUT', `/spaces/${w.spaceId}/workload/${w.member.userId}`, { hoursPerWeek: 5 }],
      ['GET', `/tasks/${task}/recurring`],
      ['PUT', `/tasks/${task}/recurring`, { kind: 'interval', every: 1, unit: 'day' }],
      ['DELETE', `/tasks/${task}/recurring`],
    ] as const)
      expect([m, u, (await rest(outsider, m, u, b))[0]]).toEqual([m, u, 404]);
    for (const o of area.ops.filter((x) => x.write)) {
      const [m, u, b] = {
        update_time_entry: ['PATCH', `/time-entries/${e.data.id}`, { note: 'x' }],
        delete_time_entry: ['DELETE', `/time-entries/${e.data.id}`],
        set_task_estimate: ['PUT', `/tasks/${task}/estimate`, { minutes: 5 }],
        set_workload_capacity: [
          'PUT',
          `/spaces/${w.spaceId}/workload/${w.member.userId}`,
          { hoursPerWeek: 5 },
        ],
        set_recurring: [
          'PUT',
          `/tasks/${task}/recurring`,
          { kind: 'interval', every: 1, unit: 'day' },
        ],
        remove_recurring: ['DELETE', `/tasks/${task}/recurring`],
      }[o.tool] as [string, string, object?];
      expect([o.tool, (await rest(read, m, u, b))[0]]).toEqual([o.tool, 403]);
    }

    await db.execute(sql`update projects set modules = '{}' where id = ${w.projectId}::uuid`);
    for (const [m, u, b] of [
      ['PATCH', `/time-entries/${e.data.id}`, { note: 'x' }],
      ['PUT', `/tasks/${task}/estimate`, { minutes: 5 }],
      ['GET', `/time-report?projectId=${w.projectId}`],
      ['GET', `/spaces/${w.spaceId}/workload`],
      ['PUT', `/tasks/${task}/recurring`, { kind: 'interval', every: 1, unit: 'day' }],
    ] as const) {
      const [s, r] = await rest(admin, m, u, b);
      expect([m, u, s, r.error?.code ?? r.code]).toEqual([m, u, 404, 'module_disabled']);
    }
  });
});
