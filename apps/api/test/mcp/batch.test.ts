// PLNRAPP-268: filters of search_tasks / GET /tasks and POST /tasks/batch (REST v1)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiTokenCreatedSchema, uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, taskArgs, world, type World } from '../sync/helpers.js';

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let w: World;
let secret: string;
let guestSecret: string;
let label: string;

async function issue(userId: string) {
  const r = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { cookie: await loginCookie(db, userId), origin: ORIGIN },
      payload: { name: 't', scope: 'write' },
    });
  return apiTokenCreatedSchema.parse(r.json()).secret;
}
async function api(method: 'GET' | 'POST', url: string, token: string, payload?: object) {
  const r = await app
    .getHttpAdapter()
    .getInstance()
    .inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload });
  return { status: r.statusCode, body: r.json() };
}
const batch = (p: object, token = secret) => api('POST', '/api/v1/tasks/batch', token, p);
const mk = async (over: object) => {
  const a = taskArgs(w, over);
  await w.member.ok('task.create', a);
  return a.id;
};
const statusOf = async (id: string) =>
  ((await api('GET', `/api/v1/tasks/${id}`, secret)).body.data as { statusId: string }).statusId;

beforeAll(async () => {
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN });
  await app.listen(0, '127.0.0.1');
  w = await world(db);
  secret = await issue(w.member.userId);
  guestSecret = await issue(w.guest.userId);
  label = uuidv7();
  await w.member.ok('label.create', {
    id: label,
    projectId: w.projectId,
    name: 'L',
    color: '#f00',
  });
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

describe('Задачи: фильтры и пачка', () => {
  it('фильтры: метка, приоритет, срок, без исполнителя, архив', async () => {
    const a = await mk({
      title: 'F1',
      priority: 3,
      dueDate: '2030-01-10',
      labels: [{ id: uuidv7(), labelId: label }],
    });
    const b = await mk({
      title: 'F2',
      priority: 1,
      dueDate: '2030-03-10',
      assignees: [{ id: uuidv7(), userId: w.member.userId }],
    });
    const c = await mk({ title: 'F3' });
    const ids = async (q: string) =>
      (
        (await api('GET', `/api/v1/tasks?projectId=${w.projectId}&${q}`, secret)).body.data as {
          id: string;
        }[]
      )
        .map((t) => t.id)
        .sort();
    expect(await ids(`labelId=${label}`)).toEqual([a]);
    expect(await ids('priority=1')).toEqual([b]);
    expect(await ids('dueBefore=2030-02-01')).toEqual([a]);
    expect(await ids('dueAfter=2030-02-01')).toEqual([b]);
    expect(await ids('unassigned=true')).toContain(c);
    expect(await ids('unassigned=true')).not.toContain(b);
    await w.member.ok('task.archive', { id: c });
    expect(await ids('archived=true')).toEqual([c]);
    expect(await ids('unassigned=true')).not.toContain(c);
  });

  it('dryRun ничего не меняет; пачка: статус + метки add/remove + исполнители + архив; ошибка одной не обрывает', async () => {
    const t1 = await mk({ title: 'B1', labels: [{ id: uuidv7(), labelId: label }] });
    const t2 = await mk({ title: 'B2' });
    const patch = {
      statusId: w.statusIds[2],
      assigneeIds: { add: [w.member.userId] },
      labelIds: { remove: [label] },
    };
    const dry = await batch({ taskIds: [t1, t2], patch, dryRun: true });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    expect(dry.body.data.matched.map((m: { title: string }) => m.title)).toEqual(['B1', 'B2']);
    expect(dry.body.data.changed).toBe(0);
    expect(await statusOf(t1)).toBe(w.statusIds[1]);

    const r = await batch({ taskIds: [t1, 'NOPE-1', t2], patch });
    expect(r.body.data.changed).toBe(2);
    expect(r.body.data.errors).toEqual([{ task: 'NOPE-1', code: 'not_found' }]);
    const got = (await api('GET', `/api/v1/tasks/${t1}`, secret)).body.data;
    expect([got.statusId, got.assigneeIds, got.labelIds]).toEqual([
      w.statusIds[2],
      [w.member.userId],
      [],
    ]);

    const g = await batch({
      filter: { projectId: w.projectId, query: 'B1' },
      patch: { archived: true },
    });
    expect(g.body.data.changed).toBe(1);
    const arch = await api('GET', `/api/v1/tasks?projectId=${w.projectId}&archived=true`, secret);
    expect(arch.body.data.map((t: { id: string }) => t.id)).toContain(t1);
  });

  it('права мутаторов: гость не меняет — ошибка в errors; пустой patch / оба источника — 400', async () => {
    const t = await mk({ title: 'G1' });
    const r = await batch({ taskIds: [t], patch: { statusId: w.statusIds[2] } }, guestSecret);
    expect(r.body.data?.changed ?? 0).toBe(0);
    expect(await statusOf(t)).toBe(w.statusIds[1]);
    expect((await batch({ taskIds: [t], patch: {} })).status).toBe(400);
    expect(
      (await batch({ taskIds: [t], filter: { query: 'x' }, patch: { archived: true } })).status,
    ).toBe(400);
  });
});
