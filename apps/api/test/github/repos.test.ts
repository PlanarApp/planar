// PLNRAPP-891: a project's github.com repositories — the list of the connection's repositories (all pages, search),
// bind (no duplicate on rebind) and unbind; GitHub is a mocked fetch
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@planar/shared';
import {
  githubChoices as C,
  githubConnections as G,
  githubRepos as R,
} from '@planar/module-github/api/schema';
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { key as pkey, world, type World } from '../sync/helpers.js';

useApp();

const WS = '00000000-0000-0000-0000-000000000000';
const KEY = randomBytes(32).toString('base64');
const TOKEN = 'ghp_repos-token';
const BIG = 3_000_000_000; // GitHub repository ids exceed 2^31
// 150 repositories of the account: acme/repo-001 … acme/repo-150
const ALL = Array.from({ length: 150 }, (_, i) => ({
  id: BIG + i + 1,
  full_name: `acme/repo-${String(i + 1).padStart(3, '0')}`,
  default_branch: i === 0 ? 'develop' : 'main',
  private: i % 2 === 0,
}));
let w: World;
let cookie: string;
let gh: string[];
let status: number;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  w = await world(db);
  cookie = await loginCookie(db, (await createUser(db, { role: 'admin' })).id);
});
beforeEach(async () => {
  process.env.PLANAR_SECRET_KEY = KEY;
  gh = [];
  status = 200;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.github.com/')) return realFetch(input, init);
    gh.push(url);
    if (status !== 200) return Response.json({ message: 'Bad credentials' }, { status });
    const u = new URL(url);
    if (u.pathname === '/user') return Response.json({ login: 'octo', id: 1 });
    if (u.pathname === '/user/repos') {
      const per = Number(u.searchParams.get('per_page'));
      const page = Number(u.searchParams.get('page'));
      return Response.json(ALL.slice((page - 1) * per, page * per));
    }
    const m = /^\/repos\/([^/]+)\/([^/]+)$/.exec(u.pathname);
    const r = m && ALL.find((x) => x.full_name === `${m[1]}/${m[2]}`);
    return r ? Response.json(r) : Response.json({ message: 'Not Found' }, { status: 404 });
  });
  await db.delete(R);
  await db.delete(C);
  await db.delete(G);
});
afterEach(() => vi.restoreAllMocks());

const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: method as 'GET',
      url: `/api/github/${url}`,
      payload: body as object | undefined,
      headers: { cookie, origin: ORIGIN, ...headers },
    });
const connect = async (scope = 'workspace', scopeId = WS) => {
  const r = await call('POST', 'connections', { scope, scopeId, token: TOKEN });
  expect(r.statusCode).toBe(201);
  gh = [];
  return r.json().connection.id as string;
};
const available = (q?: string) =>
  call('GET', `projects/${w.projectId}/available${q === undefined ? '' : `?q=${q}`}`);
const bind = (fullName: string, projectId = w.projectId) =>
  call('POST', `projects/${projectId}/repos`, { fullName });
const bound = async (projectId = w.projectId) =>
  (await call('GET', `projects/${projectId}/repos`)).json().repos as {
    id: string;
    repoId: number;
    fullName: string;
    defaultBranch: string;
    connectionId: string;
  }[];

describe('github: репозитории проекта', () => {
  it('без подключения: connected=false, а не ошибка; привязка — 409', async () => {
    const r = await available();
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ connected: false, repos: [] });
    expect((await bind('acme/repo-001')).statusCode).toBe(409);
    expect(gh).toHaveLength(0);
  });

  it('список: все 150 репозиториев постранично по 100', async () => {
    await connect();
    const r = await available();
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.connected).toBe(true);
    expect(j.repos).toHaveLength(150);
    expect(j.repos[0]).toEqual({
      repoId: BIG + 1,
      fullName: 'acme/repo-001',
      defaultBranch: 'develop',
      private: true,
    });
    expect(j.repos[149].fullName).toBe('acme/repo-150');
    expect(gh.map((u) => new URL(u).searchParams.get('page'))).toEqual(['1', '2']);
    expect(gh.every((u) => new URL(u).searchParams.get('per_page') === '100')).toBe(true);
  });

  it('поиск по части имени без учёта регистра', async () => {
    await connect();
    const j = (await available('REPO-14')).json();
    expect(j.repos.map((x: { fullName: string }) => x.fullName)).toEqual(
      Array.from({ length: 10 }, (_, i) => `acme/repo-14${i}`),
    );
  });

  it.each([401, 403])('токен отклонён (%i): понятная ошибка подключения', async (st) => {
    await connect();
    status = st;
    const r = await available();
    expect(r.statusCode).toBe(502);
    expect(r.json().message).toBe('Токен GitHub недействителен или не имеет доступа');
  });

  it('привязка, повторная привязка без дубля, отвязка удаляет запись', async () => {
    const conn = await connect();
    const r = await bind('acme/repo-001');
    expect(r.statusCode).toBe(201);
    expect(r.json().repo).toMatchObject({
      projectId: w.projectId,
      connectionId: conn,
      repoId: BIG + 1,
      fullName: 'acme/repo-001',
      defaultBranch: 'develop',
    });
    // PLNRAPP-894: then the webhook — here GitHub refuses it (404), the binding stays
    expect(gh).toEqual([
      'https://api.github.com/repos/acme/repo-001',
      'https://api.github.com/repos/acme/repo-001/hooks',
    ]);
    expect(r.json().repo).toMatchObject({ hook: false });
    expect((await bind('acme/repo-001')).statusCode).toBe(201);
    const rows = await db.select().from(R);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.repoId).toBe(BIG + 1);
    expect((await bound()).map((x) => x.fullName)).toEqual(['acme/repo-001']);

    const id = rows[0]!.id;
    expect((await call('DELETE', `repos/${id}`)).statusCode).toBe(204);
    expect(await db.select().from(R)).toHaveLength(0);
    expect(await bound()).toEqual([]);
    expect((await call('DELETE', `repos/${id}`)).statusCode).toBe(404);
  });

  it('один репозиторий — к нескольким проектам; удаление проекта убирает его привязки', async () => {
    await connect();
    const p2 = uuidv7();
    await w.admin.ok('project.create', {
      id: p2,
      spaceId: w.spaceId,
      name: 'P2',
      key: pkey(),
      rank: 'b0',
    });
    expect((await bind('acme/repo-002')).statusCode).toBe(201);
    expect((await bind('acme/repo-002', p2)).statusCode).toBe(201);
    expect(await db.select().from(R)).toHaveLength(2);
    await w.admin.ok('project.delete', { id: p2 });
    expect(await db.select().from(R).where(eq(R.projectId, p2))).toHaveLength(0);
    expect(await db.select().from(R).where(eq(R.projectId, w.projectId))).toHaveLength(1);
  });

  it('нет репозитория в GitHub — 404, неверное имя — 400, записи нет', async () => {
    await connect();
    const r = await bind('acme/nope');
    expect(r.statusCode).toBe(404);
    expect(r.json().message).toBe(
      'Репозиторий не найден в GitHub или недоступен по токену подключения',
    );
    expect((await bind('not a repo')).statusCode).toBe(400);
    expect(await db.select().from(R)).toHaveLength(0);
  });

  it('подключение с привязанными репозиториями не отключается (409), как в GitLab', async () => {
    const conn = await connect();
    await bind('acme/repo-003');
    expect((await call('DELETE', `connections/${conn}`)).statusCode).toBe(409);
    await call('DELETE', `repos/${(await bound())[0]!.id}`);
    expect((await call('DELETE', `connections/${conn}`)).statusCode).toBe(204);
  });

  it('неизвестный проект — 404; только администратор экземпляра', async () => {
    await connect();
    expect((await call('GET', `projects/${uuidv7()}/available`)).statusCode).toBe(404);
    expect((await call('GET', `projects/${uuidv7()}/repos`)).statusCode).toBe(404);
    const m = { cookie: await loginCookie(db, (await createUser(db, { role: 'member' })).id) };
    expect((await call('GET', `projects/${w.projectId}/available`, undefined, m)).statusCode).toBe(
      403,
    );
    expect((await call('GET', `projects/${w.projectId}/repos`, undefined, m)).statusCode).toBe(403);
    expect(
      (await call('POST', `projects/${w.projectId}/repos`, { fullName: 'acme/repo-001' }, m))
        .statusCode,
    ).toBe(403);
    expect((await call('DELETE', `repos/${uuidv7()}`, undefined, m)).statusCode).toBe(403);
    expect(gh).toHaveLength(0);
  });
});
