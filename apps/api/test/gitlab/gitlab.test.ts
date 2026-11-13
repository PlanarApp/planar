import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { decrypt } from '@planar/server-kit';
import { pollAll } from '@planar/module-gitlab/api';
import { gitlabConnections as P, gitlabMrs as M } from '@planar/module-gitlab/api/schema';
import { JobsService } from '../../src/jobs/jobs.js';
import { projects, settings, tasks } from '../../src/db/schema.js';
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { key as pkey, taskArgs, world, type World } from '../sync/helpers.js';

useApp();

const KEY = randomBytes(32).toString('base64');
const TOKEN = 'glpat-SECRET-token-value';
let w: World;
let cookie: string;
let srv: http.Server;
let base: string;
let hits: {
  path: string;
  q: URLSearchParams;
  token: unknown;
  method?: string;
  body?: Record<string, unknown>;
}[] = [];
let handler: (req: http.IncomingMessage, res: http.ServerResponse, q: URLSearchParams) => void;

const json = (res: http.ServerResponse, body: unknown, h: Record<string, string> = {}, st = 200) =>
  res.writeHead(st, { 'content-type': 'application/json', ...h }).end(JSON.stringify(body));
const mr = (iid: number, over: Record<string, unknown> = {}) => ({
  iid,
  title: 'без ключа',
  description: '',
  source_branch: 'main',
  state: 'opened',
  web_url: `https://gl/mr/${iid}`,
  updated_at: `2026-10-0${iid}T10:00:00.000Z`,
  author: { name: 'Ann' },
  ...over,
});

beforeAll(async () => {
  w = await world(db);
  await db
    .insert(settings)
    .values({ id: 'enabled_modules', value: ['gitlab'] })
    .onConflictDoUpdate({ target: settings.id, set: { value: ['gitlab'] } });
  cookie = await loginCookie(db, (await createUser(db, { role: 'admin' })).id);
  srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const u = new URL(req.url!, 'http://x');
      hits.push({
        path: u.pathname,
        q: u.searchParams,
        token: req.headers['private-token'],
        method: req.method,
        body: raw ? JSON.parse(raw) : undefined,
      });
      handler(req, res, u.searchParams);
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(() => void srv.close());
beforeEach(async () => {
  process.env.PLANAR_SECRET_KEY = KEY;
  hits = [];
  handler = (_, res) => json(res, [], {}, 200);
  await db.delete(M);
  await db.delete(P);
});

const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: method as 'GET',
      url: `/api/gitlab/${url}`,
      payload: body as object | undefined,
      headers: { cookie, origin: ORIGIN, ...headers },
    });
const poll = async () => pollAll(await getApp().get(JobsService).api());
const conns = (projectId = w.projectId) => `projects/${projectId}/connections`;
const addProject = async (id = 42, projectId = w.projectId) => {
  handler = (_, res) => json(res, { id, path_with_namespace: `g/p${id}` });
  const r = await call('POST', conns(projectId), {
    baseUrl: base,
    token: TOKEN,
    project: String(id),
  });
  expect(r.statusCode).toBe(201);
  return r.json().connection as { id: string; gitlabProjectId: number };
};
const mkProject = async () => {
  const id = uuidv7();
  await w.admin.ok('project.create', {
    id,
    spaceId: w.spaceId,
    name: 'P2',
    key: pkey(),
    rank: 'b0',
  });
  return id;
};
const mkTask = async (projectId = w.projectId) => {
  const id = uuidv7();
  await w.admin.ok('task.create', taskArgs(w, { id, projectId }));
  const [t] = await db.select().from(tasks).where(eq(tasks.id, id));
  const [p] = await db.$client
    .query('select key from projects where id = $1', [t!.projectId])
    .then((r) => r.rows);
  return { id, key: `${p.key}-${t!.number}` };
};
const mrsOf = (iid: number) => db.select().from(M).where(eq(M.iid, iid));
const proj = async () => (await db.select().from(P))[0]!;

describe('pt6a: токен и REST', () => {
  it('pt6a: токен шифруется AES-256-GCM, iv разный, ответы без токена', async () => {
    const c = await addProject();
    const enc1 = (await proj()).tokenEnc;
    expect(enc1).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(enc1).not.toContain(TOKEN);
    expect(Buffer.from(enc1.split(':')[1]!, 'base64')).toHaveLength(12);
    expect(Buffer.from(enc1.split(':')[2]!, 'base64')).toHaveLength(16);
    expect(decrypt(enc1, Buffer.from(KEY, 'base64'))).toBe(TOKEN);
    const patch = await call('PATCH', `connections/${c.id}`, { token: TOKEN });
    const enc2 = (await proj()).tokenEnc;
    expect(enc2.split(':')[1]).not.toBe(enc1.split(':')[1]);
    const get = await call('GET', conns());
    for (const r of [patch, get]) {
      expect(r.body).not.toContain(TOKEN);
      expect(r.body).not.toContain('tokenEnc');
    }
    expect(get.json().connections).toMatchObject([{ id: c.id, baseUrl: base, path: 'g/p42' }]);
  });

  it('pt6a: без PLANAR_SECRET_KEY сохранение токена → 503, опрос не идёт', async () => {
    const c = await addProject();
    delete process.env.PLANAR_SECRET_KEY;
    hits = [];
    const r = await call('POST', conns(), { baseUrl: base, token: 'x', project: '7' });
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toContain('"x"');
    expect((await call('PATCH', `connections/${c.id}`, { token: 'x' })).statusCode).toBe(503);
    await poll();
    expect(hits).toHaveLength(0);
    expect((await proj()).lastError).toBe('secret_key_missing');
  });

  it('pt6a: не-админ → 403, без входа → 401, Bearer → 403, неверный baseUrl → 400', async () => {
    const m = await loginCookie(db, (await createUser(db, { role: 'member' })).id);
    expect((await call('GET', conns(), undefined, { cookie: m })).statusCode).toBe(403);
    expect((await call('GET', conns(), undefined, { cookie: '' })).statusCode).toBe(401);
    const tok = await getApp()
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/tokens',
        payload: { name: 't', scope: 'write' },
        headers: { cookie, origin: ORIGIN },
      });
    const r = await call('GET', conns(), undefined, {
      cookie: '',
      authorization: `Bearer ${tok.json().secret}`,
    });
    expect(r.statusCode).toBe(403);
    const add = (o: object) =>
      call('POST', conns(), { baseUrl: base, token: 't', project: '1', ...o });
    expect((await add({ baseUrl: 'ftp://x' })).statusCode).toBe(400);
    expect((await add({ baseUrl: 'http://u:p@x' })).statusCode).toBe(400);
    expect((await add({ token: '' })).statusCode).toBe(400);
    expect(
      (await call('POST', conns(uuidv7()), { baseUrl: base, token: 't', project: '1' })).statusCode,
    ).toBe(404);
    expect((await call('GET', conns('x'))).statusCode).toBe(404);
  });

  it('pt6a: POST ищет репозиторий в GitLab с токеном; DELETE убирает его MR', async () => {
    const p = await addProject(42);
    expect(hits[0]).toMatchObject({ path: '/api/v4/projects/42', token: TOKEN });
    handler = (_, res) => json(res, { id: 7, path_with_namespace: 'g/n' });
    const p2 = (await call('POST', conns(), { baseUrl: base, token: TOKEN, project: 'g/n' })).json()
      .connection;
    expect(hits.at(-1)!.path).toBe('/api/v4/projects/g%2Fn');
    // the same repository again — the same connection; the same id from another host — 409
    const again = await call('POST', conns(), {
      baseUrl: `${base}/`,
      token: TOKEN,
      project: 'g/n',
    });
    expect(again.json().connection.id).toBe(p2.id);
    expect((await call('GET', conns())).json().connections).toHaveLength(2);
    await call('DELETE', `connections/${p2.id}`);
    const t = await mkTask();
    handler = (_, res) => json(res, [mr(1, { title: t.key })]);
    await poll();
    expect(await mrsOf(1)).toHaveLength(1);
    const [row] = await mrsOf(1);
    expect((await call('DELETE', `connections/${p.id}`)).statusCode).toBe(204);
    const ch = await db.$client.query(
      "select op from changes where entity = 'gitlabMrs' and id = $1 order by seq desc limit 1",
      [row!.id],
    );
    expect(ch.rows[0]).toMatchObject({ op: 'del' });
    expect(await mrsOf(1)).toHaveLength(0);
    expect((await call('GET', conns())).json().connections).toHaveLength(0);
    handler = (_, res) => json(res, {}, {}, 404);
    expect(
      (await call('POST', conns(), { baseUrl: base, token: TOKEN, project: '999' })).statusCode,
    ).toBe(404);
  });

  it('pt6a: репозиторий с тем же id с другого адреса в том же проекте → 409', async () => {
    await addProject(42);
    // the fake answers on another host name of the same server
    const alt = base.replace('127.0.0.1', 'localhost');
    const r = await call('POST', conns(), { baseUrl: alt, token: TOKEN, project: '42' });
    expect(r.statusCode).toBe(409);
  });

  it('pt6a: подключение связывает только задачи своего проекта; два проекта — независимо', async () => {
    const p2 = await mkProject();
    const a = await mkTask();
    const b = await mkTask(p2);
    const c1 = await addProject(42);
    handler = (_, res) => json(res, [mr(1, { title: `${a.key} ${b.key}` })]);
    await poll();
    expect((await mrsOf(1)).map((r) => r.taskId)).toEqual([a.id]);
    // the same repository in the second project: its own task, the first one stays
    await addProject(42, p2);
    await db.update(P).set({ cursor: null });
    handler = (_, res) => json(res, [mr(1, { title: `${a.key} ${b.key}` })]);
    await poll();
    expect((await mrsOf(1)).map((r) => r.taskId).sort()).toEqual([a.id, b.id].sort());
    await call('DELETE', `connections/${c1.id}`);
    expect((await mrsOf(1)).map((r) => r.taskId)).toEqual([b.id]);
    // deleting a project deletes its connections
    await w.admin.ok('task.delete', { id: b.id });
    await w.admin.ok('project.delete', { id: p2 });
    expect(await db.select().from(P)).toHaveLength(0);
  });
});

describe('pt6a: опрос', () => {
  it('pt6a: пагинация X-Next-Page (3 страницы), курсор двигается, updated_after передаётся', async () => {
    await addProject();
    const t = await mkTask();
    hits = [];
    handler = (_, res, q) => {
      const page = Number(q.get('page'));
      json(res, [mr(page, { title: t.key })], { 'x-next-page': page < 3 ? String(page + 1) : '' });
    };
    await poll();
    const mrReq = hits.filter((h) => h.path.endsWith('/merge_requests'));
    expect(mrReq.map((h) => h.q.get('page'))).toEqual(['1', '2', '3']);
    expect(mrReq[0]!.q.get('per_page')).toBe('100');
    expect(mrReq[0]!.q.get('order_by')).toBe('updated_at');
    expect(mrReq[0]!.q.get('sort')).toBe('asc');
    expect(mrReq[0]!.token).toBe(TOKEN);
    const first = Date.parse(mrReq[0]!.q.get('updated_after')!);
    expect(Date.now() - first).toBeGreaterThan(29 * 86400_000);
    expect(new Date((await proj()).cursor!).toISOString()).toBe('2026-10-03T10:00:00.000Z');
    expect((await db.select().from(M)).length).toBe(3);
    hits = [];
    handler = (_, res) => json(res, []);
    await poll();
    expect(hits.find((h) => h.path.endsWith('/merge_requests'))!.q.get('updated_after')).toBe(
      '2026-10-03T10:00:00.000Z',
    );
  });

  it('pt6a: 250 MR — фейк фильтрует по updated_after и делит на страницы по 100, обработаны все', async () => {
    await addProject();
    const t = await mkTask();
    const all = Array.from({ length: 250 }, (_, i) =>
      mr(i + 1, {
        title: t.key,
        updated_at: new Date(Date.UTC(2026, 9, 1) + i * 60_000).toISOString(),
      }),
    );
    handler = (_, res, q) => {
      const after = Date.parse(q.get('updated_after')!);
      const page = Number(q.get('page'));
      const rows = all.filter((m) => Date.parse(m.updated_at) >= after);
      json(res, rows.slice((page - 1) * 100, page * 100), {
        'x-next-page': page * 100 < rows.length ? String(page + 1) : '',
      });
    };
    // the cursor is already in the DB: the walk starts from it, not from the cursor after the first page
    await db.update(P).set({ cursor: '2026-10-01T00:00:00.000Z' });
    await poll();
    expect(await db.select().from(M)).toHaveLength(250);
    expect(new Date((await proj()).cursor!).toISOString()).toBe(all[249]!.updated_at);
  });

  it('pt6a: ключи в title/branch/description; два ключа — две строки; ключ исчез — строка удалена; неизвестный пропущен', async () => {
    await addProject();
    const a = await mkTask();
    const b = await mkTask();
    const c = await mkTask();
    handler = (_, res) =>
      json(res, [
        mr(1, {
          title: `fix ${a.key} ${c.key.toLowerCase()}`,
          source_branch: `feature/${b.key.toLowerCase()}-x`,
          description: `see ${c.key} and ZZZ-999`,
        }),
        mr(2, { title: 'нет ключей' }),
      ]);
    await poll();
    expect((await mrsOf(1)).map((r) => r.taskId).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(await mrsOf(2)).toHaveLength(0);
    expect((await mrsOf(1))[0]).toMatchObject({
      gitlabProjectId: 42,
      state: 'opened',
      authorName: 'Ann',
      webUrl: 'https://gl/mr/1',
    });
    // keys b and c are gone; reprocessing does not create rows
    handler = (_, res) =>
      json(res, [mr(1, { title: a.key, updated_at: '2026-10-05T10:00:00.000Z' })]);
    await poll();
    await poll();
    expect((await mrsOf(1)).map((r) => r.taskId)).toEqual([a.id]);
  });

  it('pt6a: 401 → last_error=unauthorized и остановка подключения до смены токена', async () => {
    const c = await addProject(1);
    await addProject(2);
    handler = (req, res) =>
      req.url!.includes('/projects/1/') ? json(res, {}, {}, 401) : json(res, []);
    await poll();
    const errs = async () =>
      (await call('GET', conns()))
        .json()
        .connections.map((x: { lastError: unknown }) => x.lastError);
    expect(await errs()).toEqual(['unauthorized', null]);
    hits = [];
    await poll();
    expect(hits.map((h) => h.path)).toEqual(['/api/v4/projects/2/merge_requests']);
    hits = [];
    await call('PATCH', `connections/${c.id}`, { token: 'new-token' });
    expect(await errs()).toEqual([null, null]);
    handler = (_, res) => json(res, []);
    await poll();
    expect(hits[0]!.token).toBe('new-token');
  });

  it('pt6a: 429 с Retry-After → один повтор; повторный 429 откладывает проект', async () => {
    await addProject();
    const t = await mkTask();
    let n = 0;
    handler = (_, res) =>
      n++ === 0 ? json(res, {}, { 'retry-after': '0' }, 429) : json(res, [mr(1, { title: t.key })]);
    await poll();
    // 429 and its retry; then GET of the open MR for its pipeline (PLNRAPP-205)
    expect(n).toBe(3);
    expect(await mrsOf(1)).toHaveLength(1);
    n = 0;
    handler = (_, res) => (n++, json(res, {}, { 'retry-after': '0' }, 429));
    await poll();
    expect(n).toBe(2);
    expect((await proj()).lastError).toBe('rate_limited');
  });

  it('pt6a: 404 и 5xx одного проекта не мешают другим; ошибка в проекте и снимается', async () => {
    const p1 = await addProject(1);
    const p2 = await addProject(2);
    const p3 = await addProject(3);
    const t = await mkTask();
    handler = (req, res) => {
      if (req.url!.includes('/projects/1/')) return json(res, {}, {}, 404);
      if (req.url!.includes('/projects/2/')) return json(res, {}, {}, 503);
      json(res, [mr(1, { title: t.key })]);
    };
    await poll();
    const byId = async (id: string) => (await db.select().from(P).where(eq(P.id, id)))[0]!;
    expect((await byId(p1.id)).lastError).toBe('not_found');
    expect((await byId(p2.id)).lastError).toBe('http_503');
    expect((await byId(p3.id)).lastError).toBeNull();
    expect((await byId(p3.id)).lastPolledAt).not.toBeNull();
    expect((await byId(p2.id)).cursor).toBeNull();
    expect(await mrsOf(1)).toHaveLength(1);
    handler = (_, res) => json(res, []);
    await poll();
    expect((await byId(p1.id)).lastError).toBeNull();
  });
});

describe('pt6a: мутаторы', () => {
  it('pt6a: merge → статус задачи по gitlabProjectSettings; без настройки не трогает', async () => {
    await addProject();
    const a = await mkTask();
    const done = w.statusIds[3]!;
    handler = (_, res) => json(res, [mr(1, { title: a.key })]);
    await w.admin.ok('gitlab.setMergedStatus', { projectId: w.projectId, statusId: null });
    await poll();
    handler = (_, res) =>
      json(res, [mr(1, { title: a.key, state: 'merged', updated_at: '2026-10-06T10:00:00.000Z' })]);
    await poll();
    expect((await mrsOf(1))[0]!.state).toBe('merged');
    expect((await db.select().from(tasks).where(eq(tasks.id, a.id)))[0]!.statusId).toBe(
      w.statusIds[1],
    );
    // setting enabled: the next merge of another MR moves the status
    await w.admin.ok('gitlab.setMergedStatus', { projectId: w.projectId, statusId: done });
    handler = (_, res) =>
      json(res, [mr(2, { title: a.key, state: 'merged', updated_at: '2026-10-07T10:00:00.000Z' })]);
    await poll();
    const [t] = await db.select().from(tasks).where(eq(tasks.id, a.id));
    expect(t!.statusId).toBe(done);
    expect(t!.completedAt).not.toBeNull();
  });

  it('pt6a: клиентский gitlab.mr.sync → forbidden; setMergedStatus чужого статуса → invalid_args', async () => {
    const a = await mkTask();
    const r = await w.admin.push('gitlab.mr.sync', {
      projectId: w.projectId,
      gitlabProjectId: 1,
      iid: 1,
      mr: {
        title: 't',
        sourceBranch: 'b',
        state: 'opened',
        authorName: 'x',
        webUrl: 'u',
        mrUpdatedAt: '2026-10-01T00:00:00.000Z',
      },
      links: [{ id: uuidv7(), taskId: a.id }],
    });
    expect(r).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await mrsOf(1)).toHaveLength(0);
    const bad = await w.admin.push('gitlab.setMergedStatus', {
      projectId: w.projectId,
      statusId: uuidv7(),
    });
    expect(bad).toMatchObject({ ok: false });
    const member = await w.member.push('gitlab.setMergedStatus', {
      projectId: w.projectId,
      statusId: null,
    });
    expect(member).toMatchObject({ ok: false, code: 'forbidden' });
  });

  it('PJ-3 pt6a: модуль выключен в проекте — подключения 404 module_disabled, опрос пропускает проект, подключение остаётся', async () => {
    const on = await addProject();
    const t = await mkTask();
    const set = (modules: string[]) =>
      db.update(projects).set({ modules }).where(eq(projects.id, w.projectId));
    await set([]);
    for (const [m, u, b] of [
      ['GET', conns()],
      ['POST', conns(), { baseUrl: base, token: TOKEN, project: '1' }],
      ['PATCH', `connections/${on.id}`, { token: TOKEN }],
      ['DELETE', `connections/${on.id}`],
    ] as [string, string, object?][]) {
      const r = await call(m, u, b);
      expect([m, u, r.statusCode, r.json().code]).toEqual([m, u, 404, 'module_disabled']);
    }
    handler = (_, res) => json(res, [mr(7, { title: t.key })]);
    hits = [];
    await poll();
    expect(hits).toHaveLength(0);
    expect(await mrsOf(7)).toHaveLength(0);
    await set(['gitlab']);
    expect((await call('GET', conns())).statusCode).toBe(200);
    await poll();
    expect(await mrsOf(7)).toHaveLength(1);
  });

  it('pt6a: удаление задачи удаляет её строки gitlabMrs', async () => {
    await addProject();
    const a = await mkTask();
    handler = (_, res) => json(res, [mr(1, { title: a.key })]);
    await poll();
    expect(await mrsOf(1)).toHaveLength(1);
    await w.admin.ok('task.delete', { id: a.id });
    expect(await mrsOf(1)).toHaveLength(0);
  });
});

describe('PLNRAPP-153: ветка, MR и опрос из задачи', () => {
  const repo = {
    id: 42,
    path_with_namespace: 'g/p42',
    default_branch: 'main',
    web_url: 'https://gl/g',
  };
  // branch: GitLab's status on branch creation (400 — already exists), mrSt — on MR creation
  const gitlab =
    (branch = 201, mrSt = 201) =>
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      const p = new URL(req.url!, 'http://x').pathname;
      const last = hits.at(-1)!;
      if (p === '/api/v4/projects/42') return json(res, repo);
      if (p.endsWith('/repository/branches')) return json(res, {}, {}, branch);
      if (p.endsWith('/merge_requests') && req.method === 'POST')
        return json(res, mr(5, { ...last.body, title: last.body!.title }), {}, mrSt);
      json(res, []);
    };
  const as = async (u: { userId: string }) => ({ cookie: await loginCookie(db, u.userId) });
  const posts = () => hits.filter((h) => h.method === 'POST').map((h) => [h.path, h.body]);

  it('MR: ветка по ключу от ветки по умолчанию, MR в неё, строка gitlabMrs — сразу', async () => {
    await addProject(42);
    const t = await mkTask();
    handler = gitlab();
    hits = [];
    const r = await call('POST', `tasks/${t.id}/mr`, {}, await as(w.member));
    expect(r.statusCode).toBe(201);
    expect(r.json()).toEqual({ webUrl: 'https://gl/mr/5' });
    expect(posts()).toEqual([
      ['/api/v4/projects/42/repository/branches', { branch: t.key, ref: 'main' }],
      [
        '/api/v4/projects/42/merge_requests',
        {
          source_branch: t.key,
          target_branch: 'main',
          title: expect.stringMatching(`^${t.key}: `),
        },
      ],
    ]);
    expect((await mrsOf(5)).map((x) => x.taskId)).toEqual([t.id]);
    handler = gitlab(400, 409);
    expect((await call('POST', `tasks/${t.id}/mr`, {})).statusCode).toBe(409);
  });

  it('ветка: уже есть — не ошибка; репозитории и опрос — по проекту задачи; права', async () => {
    const c = await addProject(42);
    const t = await mkTask();
    handler = gitlab(400);
    const r = await call('POST', `tasks/${t.id}/branch`, { connectionId: c.id });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toEqual({ webUrl: `https://gl/g/-/tree/${t.key}` });
    expect((await call('GET', `tasks/${t.id}/repos`)).json()).toEqual({
      repos: [{ id: c.id, path: 'g/p42' }],
    });
    handler = (_, res) => json(res, [mr(1, { title: t.key })]);
    const g = await as(w.guest);
    expect((await call('POST', `tasks/${t.id}/poll`, undefined, g)).statusCode).toBe(200);
    expect((await mrsOf(1)).map((x) => x.taskId)).toEqual([t.id]);
    expect((await call('POST', `tasks/${t.id}/branch`, {}, g)).statusCode).toBe(403);
    const o = await as(w.outsider);
    expect((await call('GET', `tasks/${t.id}/repos`, undefined, o)).statusCode).toBe(404);
    expect((await call('POST', `tasks/${uuidv7()}/branch`, {})).statusCode).toBe(404);
    const p2 = await mkTask(await mkProject());
    expect((await call('POST', `tasks/${p2.id}/branch`, {})).statusCode).toBe(404);
  });
});

describe('PLNRAPP-205: статус пайплайна MR и деплоя', () => {
  // the MR as GitLab returns it now: in the list (if listed) and by GET of one MR
  let cur: Record<string, unknown>;
  let listed = true;
  let pipelines: { status: string }[] = [];
  const gitlab = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const p = new URL(req.url!, 'http://x').pathname;
    if (/\/merge_requests\/\d+$/.test(p)) return json(res, cur);
    if (p.endsWith('/pipelines')) return json(res, pipelines);
    json(res, listed ? [cur] : []);
  };
  const detail = () => hits.filter((h) => /\/merge_requests\/1$/.test(h.path));
  beforeEach(() => {
    listed = true;
    pipelines = [];
  });

  it('открытый MR — head_pipeline, незавершённый перезапрашивается; слит — пайплайн ветки с merge-коммитом', async () => {
    await addProject();
    const t = await mkTask();
    const now = () => new Date().toISOString();
    cur = { ...mr(1, { title: t.key, updated_at: now() }), head_pipeline: { status: 'running' } };
    handler = gitlab;
    await poll();
    expect((await mrsOf(1))[0]!.pipelineStatus).toBe('running');
    // the MR's updated_at does not change with the pipeline: the unfinished one is fetched by GET of the MR
    listed = false;
    cur = { ...cur, head_pipeline: { status: 'failed' } };
    hits = [];
    await poll();
    expect(detail()).toHaveLength(1);
    expect((await mrsOf(1))[0]!.pipelineStatus).toBe('failed');
    hits = [];
    await poll();
    expect(detail()).toHaveLength(0);
    // merged: the pipeline of the merge commit on the target branch; none yet — null
    listed = true;
    cur = {
      ...mr(1, { title: t.key, state: 'merged', updated_at: now() }),
      merged_at: now(),
      target_branch: 'main',
      merge_commit_sha: 'abc123',
    };
    pipelines = [];
    hits = [];
    await poll();
    expect((await mrsOf(1))[0]).toMatchObject({ state: 'merged', pipelineStatus: null });
    const q = hits.find((h) => h.path.endsWith('/pipelines'))!.q;
    expect([q.get('ref'), q.get('sha')]).toEqual(['main', 'abc123']);
    listed = false;
    pipelines = [{ status: 'success' }];
    await poll();
    expect((await mrsOf(1))[0]!.pipelineStatus).toBe('success');
  });

  it('слит, а пайплайна нет 10 минут — skipped; закрытый MR не отслеживается', async () => {
    await addProject();
    const t = await mkTask();
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    cur = {
      ...mr(1, { title: t.key, state: 'merged', updated_at: ago(11) }),
      merged_at: ago(11),
      target_branch: 'main',
      sha: 'def456',
    };
    handler = gitlab;
    await poll();
    expect((await mrsOf(1))[0]!.pipelineStatus).toBe('skipped');
    cur = { ...mr(2, { title: t.key, state: 'closed', updated_at: ago(1) }) };
    hits = [];
    await poll();
    expect((await mrsOf(2))[0]!.pipelineStatus).toBeNull();
    expect(
      hits.filter((h) => h.path.includes('/merge_requests/') || h.path.endsWith('/pipelines')),
    ).toEqual([]);
  });

  it('смена статуса пайплайна запускает правила mr.pipeline своего состояния MR', async () => {
    const jobsSvc = getApp().get(JobsService);
    const enqueue = jobsSvc.enqueue.bind(jobsSvc);
    const queued: { queue: string; data: Record<string, unknown> }[] = [];
    jobsSvc.enqueue = async (queue, data) => void queued.push({ queue, data: data as never });
    await db
      .update(settings)
      .set({ value: ['gitlab', 'automations'] })
      .where(eq(settings.id, 'enabled_modules'));
    const setModule = (enabled: boolean) =>
      w.admin.ok('project.setModule', {
        projectId: w.projectId,
        moduleId: 'automations',
        enabled,
      });
    try {
      await setModule(true);
      await addProject();
      const t = await mkTask();
      const rule = async (mrState: string, pipeline: string[]) => {
        const id = uuidv7();
        await w.admin.ok('automations.create', {
          id,
          projectId: w.projectId,
          name: 'CI',
          trigger: { type: 'mr.pipeline', mr: mrState, pipeline },
          actions: [{ type: 'add_comment', text: 'CI' }],
        });
        return id;
      };
      const failed = await rule('opened', ['failed']);
      const deployed = await rule('merged', ['success', 'skipped']);
      const fired = () =>
        queued.filter((j) => j.queue === 'automations.run').map((j) => j.data.ruleId);
      cur = {
        ...mr(1, { title: t.key, updated_at: new Date().toISOString() }),
        head_pipeline: { status: 'running' },
      };
      listed = true;
      handler = gitlab;
      await poll();
      expect(fired()).toEqual([]);
      cur = { ...cur, head_pipeline: { status: 'failed' } };
      await poll();
      expect(fired()).toEqual([failed]);
      // the same status again — no new event
      await poll();
      expect(fired()).toEqual([failed]);
      cur = {
        ...mr(1, { title: t.key, state: 'merged', updated_at: new Date().toISOString() }),
        merged_at: new Date().toISOString(),
        target_branch: 'main',
        merge_commit_sha: 'abc',
      };
      pipelines = [{ status: 'success' }];
      await poll();
      expect(fired()).toEqual([failed, deployed]);
    } finally {
      await setModule(false);
      jobsSvc.enqueue = enqueue;
      await db
        .update(settings)
        .set({ value: ['gitlab'] })
        .where(eq(settings.id, 'enabled_modules'));
    }
  });
});
