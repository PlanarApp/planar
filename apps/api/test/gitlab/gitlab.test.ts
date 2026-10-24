import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { decrypt } from '../../../../modules/gitlab/api/crypto.js';
import { pollAll } from '@planar/module-gitlab/api';
import {
  gitlabConfig as C,
  gitlabMrs as M,
  gitlabProjects as P,
} from '@planar/module-gitlab/api/schema';
import { JobsService } from '../../src/jobs/jobs.js';
import { settings, tasks } from '../../src/db/schema.js';
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { taskArgs, world, type World } from '../sync/helpers.js';

useApp();

const KEY = randomBytes(32).toString('base64');
const TOKEN = 'glpat-SECRET-token-value';
let w: World;
let cookie: string;
let srv: http.Server;
let base: string;
let hits: { path: string; q: URLSearchParams; token: unknown }[] = [];
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
    const u = new URL(req.url!, 'http://x');
    hits.push({ path: u.pathname, q: u.searchParams, token: req.headers['private-token'] });
    handler(req, res, u.searchParams);
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
  await db.delete(C);
  await call('PUT', 'config', { baseUrl: base, token: TOKEN });
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
const addProject = async (id = 42) => {
  handler = (_, res) => json(res, { id, path_with_namespace: `g/p${id}` });
  const r = await call('POST', 'projects', { project: String(id) });
  expect(r.statusCode).toBe(201);
  return r.json().project as { id: string; gitlabProjectId: number };
};
const mkTask = async () => {
  const id = uuidv7();
  await w.admin.ok('task.create', taskArgs(w, { id }));
  const [t] = await db.select().from(tasks).where(eq(tasks.id, id));
  const [p] = await db.$client
    .query('select key from projects where id = $1', [t!.projectId])
    .then((r) => r.rows);
  return { id, key: `${p.key}-${t!.number}` };
};
const mrsOf = (iid: number) => db.select().from(M).where(eq(M.iid, iid));
const proj = async () => (await db.select().from(P))[0]!;
const cfg = async () => (await db.select().from(C))[0]!;

describe('pt6a: токен и REST', () => {
  it('pt6a: токен шифруется AES-256-GCM, iv разный, ответы без токена', async () => {
    const enc1 = (await cfg()).tokenEnc!;
    expect(enc1).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(enc1).not.toContain(TOKEN);
    expect(Buffer.from(enc1.split(':')[1]!, 'base64')).toHaveLength(12);
    expect(Buffer.from(enc1.split(':')[2]!, 'base64')).toHaveLength(16);
    expect(decrypt(enc1, Buffer.from(KEY, 'base64'))).toBe(TOKEN);
    const put = await call('PUT', 'config', { token: TOKEN, intervalSec: 300 });
    const enc2 = (await cfg()).tokenEnc!;
    expect(enc2.split(':')[1]).not.toBe(enc1.split(':')[1]);
    const get = await call('GET', 'config');
    for (const r of [put, get]) {
      expect(r.body).not.toContain(TOKEN);
      expect(r.body).not.toContain('tokenEnc');
      expect(r.json()).toMatchObject({ baseUrl: base, hasToken: true, intervalSec: 300 });
    }
    expect((await call('PUT', 'config', { token: null })).json().hasToken).toBe(false);
  });

  it('pt6a: без PLANAR_SECRET_KEY сохранение токена → 503, опрос не идёт', async () => {
    await addProject();
    delete process.env.PLANAR_SECRET_KEY;
    const r = await call('PUT', 'config', { token: 'x' });
    expect(r.statusCode).toBe(503);
    expect(r.body).not.toContain('"x"');
    hits = [];
    await poll();
    expect(hits).toHaveLength(0);
    expect((await cfg()).lastError).toBe('secret_key_missing');
  });

  it('pt6a: не-админ → 403, без входа → 401, Bearer → 403, неверный baseUrl → 400', async () => {
    const m = await loginCookie(db, (await createUser(db, { role: 'member' })).id);
    expect((await call('GET', 'config', undefined, { cookie: m })).statusCode).toBe(403);
    expect((await call('GET', 'config', undefined, { cookie: '' })).statusCode).toBe(401);
    const tok = await getApp()
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/tokens',
        payload: { name: 't', scope: 'write' },
        headers: { cookie, origin: ORIGIN },
      });
    const r = await call('GET', 'config', undefined, {
      cookie: '',
      authorization: `Bearer ${tok.json().secret}`,
    });
    expect(r.statusCode).toBe(403);
    expect((await call('PUT', 'config', { baseUrl: 'ftp://x' })).statusCode).toBe(400);
    expect((await call('PUT', 'config', { baseUrl: 'http://u:p@x' })).statusCode).toBe(400);
    expect((await call('PUT', 'config', { intervalSec: 5 })).statusCode).toBe(400);
  });

  it('pt6a: POST projects ищет проект в GitLab с токеном; DELETE убирает его MR', async () => {
    const p = await addProject(42);
    expect(hits[0]).toMatchObject({ path: '/api/v4/projects/42', token: TOKEN });
    handler = (_, res) => json(res, { id: 7, path_with_namespace: 'g/n' });
    const p2 = (await call('POST', 'projects', { project: 'g/n' })).json().project;
    expect(hits.at(-1)!.path).toBe('/api/v4/projects/g%2Fn');
    await call('DELETE', `projects/${p2.id}`);
    const t = await mkTask();
    handler = (_, res) => json(res, [mr(1, { title: t.key })]);
    await poll();
    expect(await mrsOf(1)).toHaveLength(1);
    const [row] = await mrsOf(1);
    expect((await call('DELETE', `projects/${p.id}`)).statusCode).toBe(204);
    const ch = await db.$client.query(
      "select op from changes where entity = 'gitlabMrs' and id = $1 order by seq desc limit 1",
      [row!.id],
    );
    expect(ch.rows[0]).toMatchObject({ op: 'del' });
    expect(await mrsOf(1)).toHaveLength(0);
    expect((await call('GET', 'config')).json().projects).toHaveLength(0);
    handler = (_, res) => json(res, {}, {}, 404);
    expect((await call('POST', 'projects', { project: '999' })).statusCode).toBe(404);
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
    // курсор в БД уже есть: обход идёт от него, а не от курсора после первой страницы
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
    // ключи b и c исчезли; повторная обработка не плодит строки
    handler = (_, res) =>
      json(res, [mr(1, { title: a.key, updated_at: '2026-10-05T10:00:00.000Z' })]);
    await poll();
    await poll();
    expect((await mrsOf(1)).map((r) => r.taskId)).toEqual([a.id]);
  });

  it('pt6a: 401 → last_error=unauthorized и остановка до смены токена', async () => {
    await addProject();
    handler = (_, res) => json(res, {}, {}, 401);
    await poll();
    expect((await cfg()).lastError).toBe('unauthorized');
    expect((await call('GET', 'config')).json().lastError).toBe('unauthorized');
    hits = [];
    await poll();
    expect(hits).toHaveLength(0);
    await call('PUT', 'config', { token: 'new-token' });
    expect((await cfg()).lastError).toBeNull();
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
    expect(n).toBe(2);
    expect(await mrsOf(1)).toHaveLength(1);
    n = 0;
    handler = (_, res) => (n++, json(res, {}, { 'retry-after': '0' }, 429));
    await poll();
    expect(n).toBe(2);
    expect((await proj()).lastError).toBe('rate_limited');
    expect((await cfg()).lastError).toBeNull();
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
    expect((await cfg()).lastError).toBeNull();
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
    // настройка включена: следующий merge другого MR двигает статус
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
