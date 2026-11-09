import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { uuidv7, v1TaskSchema } from '@planar/shared';
import { createApp } from '../../src/app.js';
import * as schema from '../../src/db/schema.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, key, newDb, world, type World } from '../sync/helpers.js';

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let w: World;
let cookies: Record<'admin' | 'member' | 'guest' | 'outsider', string>;

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
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

type Who = keyof typeof cookies;
const call = (method: 'GET' | 'POST' | 'PATCH', url: string, who?: Who, payload?: unknown) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method,
      url,
      headers: { ...(who && { cookie: cookies[who] }), origin: ORIGIN },
      payload: payload as object,
    });
const get = (url: string, who: Who = 'admin') => call('GET', url, who);
const create = async (body: Record<string, unknown>, who: Who = 'admin') => {
  const r = await call('POST', '/api/v1/tasks', who, {
    projectId: w.projectId,
    title: 'T',
    ...body,
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().data as { id: string; key: string };
};

describe('REST /api/v1: чтение', () => {
  it('без входа → 401', async () => {
    expect((await call('GET', '/api/v1/spaces')).statusCode).toBe(401);
  });

  it('spaces: только свои', async () => {
    const mine = (await get('/api/v1/spaces', 'member')).json();
    expect(mine.data.map((s: { id: string }) => s.id)).toEqual([w.spaceId]);
    expect(mine.nextCursor).toBeNull();
    expect((await get('/api/v1/spaces', 'outsider')).json().data).toEqual([]);
  });

  it('projects: только свои; чужое пространство → 404', async () => {
    const r = (await get(`/api/v1/projects?spaceId=${w.spaceId}`, 'guest')).json();
    expect(r.data.map((p: { id: string }) => p.id)).toEqual([w.projectId]);
    expect((await get('/api/v1/projects', 'outsider')).json().data).toEqual([]);
    const bad = await get(`/api/v1/projects?spaceId=${w.spaceId}`, 'outsider');
    expect(bad.statusCode).toBe(404);
    expect(bad.json().code).toBe('not_found');
  });

  it('tasks: неверные параметры → 400 invalid_request', async () => {
    for (const q of ['limit=0', 'limit=201', 'projectId=x', 'cursor=!!', 'updatedAfter=вчера']) {
      const r = await get(`/api/v1/tasks?${q}`);
      expect(r.statusCode, q).toBe(400);
      expect(r.json().code).toBe('invalid_request');
    }
  });

  it('tasks: фильтры project/status/assignee=me/updatedAfter', async () => {
    const other = uuidv7();
    await w.admin.ok('project.create', {
      id: other,
      spaceId: w.spaceId,
      name: 'P2',
      key: key(),
      rank: 'a1',
    });
    const a = await create({ title: 'a', assigneeIds: [w.member.userId] });
    const b = await create({ title: 'b', statusId: w.statusIds[2] });
    const c = await create({ title: 'c', projectId: other });
    const ids = async (q: string, who: Who = 'admin') =>
      ((await get(`/api/v1/tasks?${q}`, who)).json().data as { id: string }[]).map((t) => t.id);

    expect(await ids(`projectId=${other}`)).toEqual([c.id]);
    expect(await ids(`projectId=${w.projectId}&statusId=${w.statusIds[2]}`)).toEqual([b.id]);
    expect(await ids('assigneeId=me', 'member')).toEqual([a.id]);
    expect(await ids(`assigneeId=${w.member.userId}`)).toEqual([a.id]);
    expect(await ids('assigneeId=me', 'admin')).toEqual([]);

    // PLNRAPP-140: an open checklist item / comment assigned to me makes the task mine
    const item = uuidv7();
    await w.member.ok('checklist.add', { id: item, taskId: b.id, text: 'п', rank: 'a0' });
    await w.member.ok('checklist.update', { id: item, assigneeId: w.admin.userId });
    await w.member.ok('comment.create', {
      id: uuidv7(),
      taskId: c.id,
      body: { type: 'doc', content: [] },
      assigneeId: w.admin.userId,
    });
    expect((await ids('assigneeId=me', 'admin')).sort()).toEqual([b.id, c.id].sort());
    expect((await ids(`assigneeId=${w.admin.userId}`, 'admin')).sort()).toEqual(
      [b.id, c.id].sort(),
    );
    expect(await ids(`assigneeId=${w.admin.userId}`, 'member')).toEqual([]); // not for others
    await w.member.ok('checklist.update', { id: item, done: true });
    expect(await ids('assigneeId=me', 'admin')).toEqual([c.id]);
    const notes = (await w.admin.bootstrap()).data.notifications as Record<string, unknown>[];
    expect(notes.find((n) => n.kind === 'checklist_assigned')).toMatchObject({
      taskId: b.id,
      body: 'п',
      actorId: w.member.userId,
    });

    const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, b.id));
    const after = new Date(Date.parse(row!.updatedAt) - 1).toISOString();
    expect(await ids(`updatedAfter=${after}`)).toContain(b.id);
    expect(
      await ids(`updatedAfter=${new Date(Date.parse(row!.updatedAt)).toISOString()}`),
    ).not.toContain(b.id);
    expect(await ids('', 'outsider')).toEqual([]);
  });

  it('tasks: курсор — 2 страницы без пропусков и повторов', async () => {
    const pw = await world(db);
    const ck = await loginCookie(db, pw.admin.userId);
    for (let i = 0; i < 5; i++)
      await pw.admin.ok('task.create', {
        id: uuidv7(),
        projectId: pw.projectId,
        statusId: pw.statusIds[1],
        title: `t${i}`,
        rank: `a${i}`,
      });
    const fetchPage = async (cursor?: string) => {
      const r = await app
        .getHttpAdapter()
        .getInstance()
        .inject({
          method: 'GET',
          url: `/api/v1/tasks?projectId=${pw.projectId}&limit=3${cursor ? `&cursor=${cursor}` : ''}`,
          headers: { cookie: ck },
        });
      return r.json() as { data: { id: string }[]; nextCursor: string | null };
    };
    const p1 = await fetchPage();
    expect(p1.data).toHaveLength(3);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = await fetchPage(p1.nextCursor!);
    expect(p2.data).toHaveLength(2);
    expect(p2.nextCursor).toBeNull();
    const all = [...p1.data, ...p2.data].map((t) => t.id);
    expect(new Set(all).size).toBe(5);
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.projectId, pw.projectId));
    expect([...all].sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it('get по id и по key; чужая → 404', async () => {
    const t = await create({ title: 'by key' });
    expect(t.key).toMatch(/^K[A-Z0-9]+-\d+$/);
    const byId = (await get(`/api/v1/tasks/${t.id}`, 'guest')).json();
    const byKey = (await get(`/api/v1/tasks/${t.key}`, 'guest')).json();
    expect(byKey).toEqual(byId);
    expect(v1TaskSchema.safeParse(byId.data).success).toBe(true);
    for (const ref of [t.id, t.key, 'NOPE-1', 'zzz', uuidv7()]) {
      const r = await get(`/api/v1/tasks/${ref}`, 'outsider');
      expect(r.statusCode, ref).toBe(404);
      expect(r.json().code).toBe('not_found');
    }
  });
});

describe('REST /api/v1: запись', () => {
  it('POST: number, key, assignees, labels; ответ проходит v1TaskSchema', async () => {
    const labelId = uuidv7();
    await w.admin.ok('label.create', {
      id: labelId,
      projectId: w.projectId,
      name: 'bug',
      color: '#f00',
    });
    const t = (
      await call('POST', '/api/v1/tasks', 'member', {
        projectId: w.projectId,
        title: 'Новая',
        priority: 2,
        dueDate: '2026-12-31',
        assigneeIds: [w.admin.userId],
        labelIds: [labelId],
      })
    ).json().data;
    expect(v1TaskSchema.safeParse(t).success).toBe(true);
    expect(t).toMatchObject({
      title: 'Новая',
      priority: 2,
      dueDate: '2026-12-31',
      createdBy: w.member.userId,
      assigneeIds: [w.admin.userId],
      labelIds: [labelId],
    });
    expect(t.number).toBeGreaterThan(0);
    expect(t.key.endsWith(`-${t.number}`)).toBe(true);
  });

  it('POST: ошибка в labelIds чужого пространства → 400, задачи нет', async () => {
    const other = await world(db);
    const foreign = uuidv7();
    await other.admin.ok('label.create', {
      id: foreign,
      projectId: other.projectId,
      name: 'x',
      color: '#000',
    });
    const title = `rollback-${uuidv7()}`;
    const r = await call('POST', '/api/v1/tasks', 'admin', {
      projectId: w.projectId,
      title,
      labelIds: [foreign],
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('invalid_request');
    expect(await db.select().from(schema.tasks).where(eq(schema.tasks.title, title))).toEqual([]);
  });

  it('POST: statusId по умолчанию — первый todo; rank после последней', async () => {
    const a = (await get(`/api/v1/tasks/${(await create({})).id}`)).json().data;
    const b = (await get(`/api/v1/tasks/${(await create({})).id}`)).json().data;
    expect(a.statusId).toBe(w.statusIds[1]);
    expect(b.rank > a.rank).toBe(true);
  });

  it('POST: description текст → doc с mention', async () => {
    const login = (
      await db.select().from(schema.users).where(eq(schema.users.id, w.member.userId))
    )[0]!.login;
    const t = await create({ description: `первая\nпривет @${login}` });
    const d = (await get(`/api/v1/tasks/${t.id}`)).json().data.description;
    expect(d.type).toBe('doc');
    expect(d.content).toHaveLength(2);
    expect(JSON.stringify(d)).toContain(`"type":"mention","attrs":{"id":"${w.member.userId}"`);
  });

  it('POST: неверное тело → 400 с issues; чужой проект → 404', async () => {
    const r = await call('POST', '/api/v1/tasks', 'admin', { title: '' });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('invalid_request');
    expect(r.json().details.length).toBeGreaterThan(0);
    const o = await call('POST', '/api/v1/tasks', 'outsider', {
      projectId: w.projectId,
      title: 'x',
    });
    expect(o.statusCode).toBe(404);
  });

  it('guest не создаёт задачу → 403', async () => {
    const r = await call('POST', '/api/v1/tasks', 'guest', { projectId: w.projectId, title: 'x' });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('forbidden');
  });

  it('PATCH: замена assigneeIds/labelIds', async () => {
    const l1 = uuidv7();
    const l2 = uuidv7();
    for (const id of [l1, l2])
      await w.admin.ok('label.create', {
        id,
        projectId: w.projectId,
        name: id.slice(-6),
        color: '#0f0',
      });
    const t = await create({ assigneeIds: [w.admin.userId], labelIds: [l1] });
    const r = await call('PATCH', `/api/v1/tasks/${t.key}`, 'member', {
      assigneeIds: [w.member.userId],
      labelIds: [l2],
      title: 'Переименована',
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().data).toMatchObject({
      title: 'Переименована',
      assigneeIds: [w.member.userId],
      labelIds: [l2],
    });
    const same = await call('PATCH', `/api/v1/tasks/${t.id}`, 'member', {});
    expect(same.json().data.title).toBe('Переименована');
  });

  it('PATCH: смена статуса → completedAt; обратно → null', async () => {
    const t = await create({});
    const done = (
      await call('PATCH', `/api/v1/tasks/${t.id}`, 'admin', { statusId: w.statusIds[3] })
    ).json();
    expect(done.data.completedAt).not.toBeNull();
    const back = (
      await call('PATCH', `/api/v1/tasks/${t.id}`, 'admin', { statusId: w.statusIds[1] })
    ).json();
    expect(back.data.completedAt).toBeNull();
  });

  it('PATCH: description null; чужая → 404; guest → 403; чужой статус → 400', async () => {
    const t = await create({ description: 'x' });
    const r = await call('PATCH', `/api/v1/tasks/${t.id}`, 'admin', { description: null });
    expect(r.json().data.description).toBeNull();
    expect(
      (await call('PATCH', `/api/v1/tasks/${t.id}`, 'outsider', { title: 'z' })).statusCode,
    ).toBe(404);
    expect((await call('PATCH', `/api/v1/tasks/${t.id}`, 'guest', { title: 'z' })).statusCode).toBe(
      403,
    );
    const other = await world(db);
    const bad = await call('PATCH', `/api/v1/tasks/${t.id}`, 'admin', {
      statusId: other.statusIds[0],
    });
    expect(bad.statusCode).toBe(400);
  });

  it('changes пишутся: pull второго клиента видит задачу', async () => {
    const { cursor } = await w.member.bootstrap();
    const t = await create({ title: 'для pull' });
    const pull = await w.member.pull(cursor);
    expect(pull.changes.some((c) => c.entity === 'tasks' && c.id === t.id)).toBe(true);
  });

  it('activity: актор — пользователь запроса', async () => {
    const t = await create({}, 'member');
    const rows = await db.select().from(schema.activity).where(eq(schema.activity.taskId, t.id));
    expect(rows.map((r) => [r.kind, r.actorId])).toContainEqual(['created', w.member.userId]);
  });
});

describe('REST /api/v1: комментарии', () => {
  it('POST с @login → mentions и уведомление mentioned; GET по createdAt asc', async () => {
    const [m] = await db.select().from(schema.users).where(eq(schema.users.id, w.member.userId));
    const t = await create({});
    const r1 = await call('POST', `/api/v1/tasks/${t.key}/comments`, 'admin', {
      text: `привет @${m!.login}, глянь`,
    });
    expect(r1.statusCode, r1.body).toBe(201);
    expect(r1.json().data).toMatchObject({
      taskId: t.id,
      authorId: w.admin.userId,
      mentions: [w.member.userId],
    });
    const r2 = await call('POST', `/api/v1/tasks/${t.id}/comments`, 'member', { text: 'второй' });
    expect(r2.statusCode).toBe(201);
    const list = (await get(`/api/v1/tasks/${t.id}/comments`, 'guest')).json();
    expect(list.data.map((c: { id: string }) => c.id)).toEqual([
      r1.json().data.id,
      r2.json().data.id,
    ]);
    expect(list.nextCursor).toBeNull();
    const notes = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, w.member.userId));
    expect(notes.some((n) => n.kind === 'mentioned' && n.taskId === t.id)).toBe(true);
  });

  it('комментарии: курсор, чужая задача → 404, guest не пишет, пустой text → 400', async () => {
    const t = await create({});
    for (const text of ['a', 'b', 'c'])
      expect(
        (await call('POST', `/api/v1/tasks/${t.id}/comments`, 'admin', { text })).statusCode,
      ).toBe(201);
    const p1 = (await get(`/api/v1/tasks/${t.id}/comments?limit=2`)).json();
    const p2 = (await get(`/api/v1/tasks/${t.id}/comments?limit=2&cursor=${p1.nextCursor}`)).json();
    expect(p1.data).toHaveLength(2);
    expect(p2.data).toHaveLength(1);
    expect(new Set([...p1.data, ...p2.data].map((c: { id: string }) => c.id)).size).toBe(3);
    expect((await get(`/api/v1/tasks/${t.id}/comments`, 'outsider')).statusCode).toBe(404);
    expect(
      (await call('POST', `/api/v1/tasks/${t.id}/comments`, 'outsider', { text: 'x' })).statusCode,
    ).toBe(404);
    expect(
      (await call('POST', `/api/v1/tasks/${t.id}/comments`, 'admin', { text: '' })).statusCode,
    ).toBe(400);
  });
});

describe('REST /api/v1: OpenAPI', () => {
  it('openapi.json: все пути, валидная структура', async () => {
    const r = await get('/api/v1/openapi.json', 'member');
    expect(r.statusCode).toBe(200);
    const doc = JSON.parse(r.body);
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/api/v1/links/{id}',
      '/api/v1/projects',
      '/api/v1/projects/{id}/automations',
      '/api/v1/projects/{id}/cycles',
      '/api/v1/projects/{id}/cycles/current',
      '/api/v1/projects/{id}/fields',
      '/api/v1/spaces',
      '/api/v1/tasks',
      '/api/v1/tasks/{task}',
      '/api/v1/tasks/{task}/comments',
      '/api/v1/tasks/{task}/links',
      '/api/v1/time-entries',
      '/api/v1/timer',
      '/api/v1/timer/start',
      '/api/v1/timer/stop',
    ]);
    expect(Object.keys(doc.paths['/api/v1/tasks/{task}'])).toEqual(['get', 'patch']);
    expect(doc.components.schemas.Task.properties).toHaveProperty('assigneeIds');
    expect(doc.components.schemas.CreateTask.required).toEqual(['projectId', 'title']);
  });

  it('openapi.json без входа → 401', async () => {
    expect((await call('GET', '/api/v1/openapi.json')).statusCode).toBe(401);
  });
});

describe('REST /api/v1: пользовательские поля', () => {
  const mkField = (over: Record<string, unknown> = {}, who = w.admin, projectId = w.projectId) => {
    const id = uuidv7();
    return who
      .ok('field.create', { id, projectId, name: 'F', type: 'number', rank: 'a0', ...over })
      .then(() => id);
  };
  const patch = (t: string, fields: unknown) =>
    call('PATCH', `/api/v1/tasks/${t}`, 'member', { fields });

  it('fields: GET отдаёт определения по rank, чужому проекту — 404', async () => {
    const b = await mkField({ name: 'B', rank: 'b0' });
    const a = await mkField({ name: 'A', rank: 'a0' });
    const r = await get(`/api/v1/projects/${w.projectId}/fields`, 'member');
    expect(r.statusCode).toBe(200);
    const ids = r.json().data.map((f: { id: string }) => f.id);
    expect(ids.indexOf(a)).toBeLessThan(ids.indexOf(b));
    expect(r.json().data[0]).toMatchObject({ projectId: w.projectId });
    const o = await get(`/api/v1/projects/${w.projectId}/fields`, 'outsider');
    expect(o.statusCode).toBe(404);
    expect(o.json().code).toBe('not_found');
  });

  it('fields: PATCH ставит значение, null убирает, другие ключи не трогает', async () => {
    const f1 = await mkField();
    const f2 = await mkField({ rank: 'a1' });
    const t = await create({});
    const r = await patch(t.id, { [f1]: 5, [f2]: 7 });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().data.fields).toEqual({ [f1]: 5, [f2]: 7 });
    const r2 = await patch(t.id, { [f1]: null });
    expect(r2.json().data.fields).toEqual({ [f2]: 7 });
    expect(v1TaskSchema.safeParse(r2.json().data).success).toBe(true);
  });

  it('fields: неверное значение → 400 invalid_request', async () => {
    const f = await mkField();
    const t = await create({});
    const r = await patch(t.id, { [f]: 'не число' });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('invalid_request');
    expect((await patch(t.id, { 'не-uuid': 1 })).statusCode).toBe(400);
  });

  it('fields: поле другого проекта → 400', async () => {
    const w2 = await world(db);
    const alien = await mkField({}, w2.admin, w2.projectId);
    const t = await create({});
    const r = await patch(t.id, { [alien]: 1 });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe('invalid_request');
  });
});
