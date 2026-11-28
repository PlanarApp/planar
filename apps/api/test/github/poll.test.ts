// PLNRAPP-893: the GitHub poller — a new PR / commit with the task key appears after one cycle without a webhook,
// a repeated cycle makes no duplicates (conditional requests answered 304), the rate limit (403 + X-RateLimit-*,
// 429 + Retry-After) defers the connection's poll without an exception, one repository's 404 does not stop
// the others; GitHub is a mocked fetch
import { createHash, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { api as githubApi, pollAll } from '@planar/module-github/api';
import {
  githubChoices as C,
  githubCommits as GC,
  githubConnections as G,
  githubPrs as GP,
  githubRepos as R,
} from '@planar/module-github/api/schema';
import { JobsService } from '../../src/jobs/jobs.js';
import { tasks } from '../../src/db/schema.js';
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { taskArgs, world, type World } from '../sync/helpers.js';

useApp();

const WS = '00000000-0000-0000-0000-000000000000';
const KEY = randomBytes(32).toString('base64');
const REPOS: Record<string, { id: number; full_name: string; default_branch: string }> = {
  'acme/app': { id: 3_000_000_777, full_name: 'acme/app', default_branch: 'main' },
  'acme/lib': { id: 3_000_000_778, full_name: 'acme/lib', default_branch: 'main' },
};
const SHA1 = '0123456789abcdef0123456789abcdef01234567';
const SHA2 = 'fedcba9876543210fedcba9876543210fedcba98';
let w: World;
let cookie: string;
/** the lists of each repository: `${fullName}/pulls`, `${fullName}/commits` */
let lists: Record<string, Record<string, unknown>[]>;
/** a forced answer of a path (the rate limit, 404) */
let fail: Record<string, () => Response>;
let gh: { url: URL; etag: string | undefined }[];
const realFetch = globalThis.fetch;

const etagOf = (body: unknown) =>
  `W/"${createHash('sha1').update(JSON.stringify(body)).digest('hex')}"`;

beforeAll(async () => {
  w = await world(db);
  cookie = await loginCookie(db, (await createUser(db, { role: 'admin' })).id);
});
beforeEach(async () => {
  process.env.PLANAR_SECRET_KEY = KEY;
  gh = [];
  lists = {};
  fail = {};
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.github.com/')) return realFetch(input, init);
    const u = new URL(url);
    const etag = (init?.headers as Record<string, string> | undefined)?.['If-None-Match'];
    gh.push({ url: u, etag });
    const forced = fail[u.pathname];
    if (forced) return forced();
    if (u.pathname === '/user') return Response.json({ login: 'octo', id: 1 });
    const m = /^\/repos\/([^/]+\/[^/]+)(\/pulls|\/commits)?$/.exec(u.pathname);
    const repo = m && REPOS[m[1]!];
    if (repo && !m[2]) return Response.json(repo);
    if (repo) {
      const body = lists[`${m[1]}${m[2]}`] ?? [];
      const tag = etagOf(body);
      if (etag === tag) return new Response(null, { status: 304, headers: { etag: tag } });
      return Response.json(body, {
        headers: { etag: tag, 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '0' },
      });
    }
    return Response.json({ message: 'Not Found' }, { status: 404 });
  });
  await db.delete(GP);
  await db.delete(GC);
  await db.delete(R);
  await db.delete(C);
  await db.delete(G);
});
afterEach(() => vi.restoreAllMocks());

const call = (method: string, url: string, body?: unknown) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: method as 'GET',
      url: `/api/github/${url}`,
      payload: body as object | undefined,
      headers: { cookie, origin: ORIGIN },
    });
const connect = async () =>
  expect(
    (await call('POST', 'connections', { scope: 'workspace', scopeId: WS, token: 'ghp_x' }))
      .statusCode,
  ).toBe(201);
const bindRepo = async (fullName = 'acme/app') => {
  const r = await call('POST', `projects/${w.projectId}/repos`, { fullName });
  expect(r.statusCode).toBe(201);
  return r.json().repo.id as string;
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
const pr = (number: number, title: string, repo = 'acme/app') => ({
  number,
  title,
  state: 'open',
  draft: false,
  merged_at: null,
  html_url: `https://github.com/${repo}/pull/${number}`,
  updated_at: new Date().toISOString(),
  head: { ref: 'feature/x' },
  user: { login: 'octo' },
});
const commit = (sha: string, message: string) => ({
  sha,
  html_url: `https://github.com/acme/app/commit/${sha}`,
  commit: { message, author: { name: 'Octo Cat', date: new Date().toISOString() } },
});
const poll = async () => pollAll(await getApp().get(JobsService).api());
const prsOf = (taskId: string) => db.select().from(GP).where(eq(GP.taskId, taskId));
const commitsOf = (taskId: string) => db.select().from(GC).where(eq(GC.taskId, taskId));
const ghPaths = () => gh.map((x) => x.url.pathname);
const connection = async () => (await db.select().from(G))[0]!;

describe('github: поллер', () => {
  it('модуль регистрирует задачи планировщика', () => {
    const js = (githubApi.jobs ?? []) as { queue: string; cron?: string }[];
    expect(js.map((j) => j.queue)).toEqual(['github.tick', 'github.poll']);
    expect(js[0]!.cron).toBe('* * * * *');
  });

  it('новый PR и коммит с ключом — за один цикл; повторный цикл — условные запросы, без дублей', async () => {
    const a = await mkTask();
    await connect();
    const repo = await bindRepo();
    lists['acme/app/pulls'] = [pr(1, `${a.key} поллер`), pr(2, 'unrelated')];
    gh = [];
    await poll();
    expect(ghPaths()).toEqual(['/repos/acme/app/pulls', '/repos/acme/app/commits']);
    expect(gh.every((x) => x.etag === undefined)).toBe(true);
    expect((await prsOf(a.id)).map((x) => x.number)).toEqual([1]);
    const [b1] = await db.select().from(R).where(eq(R.id, repo));
    expect(b1!.syncedAt).not.toBeNull();
    expect(b1!.prsEtag).toBe(etagOf(lists['acme/app/pulls']));
    expect(b1!.lastError).toBeNull();

    // nothing changed: both lists answer 304, no duplicates
    gh = [];
    await poll();
    expect(gh).toHaveLength(2);
    expect(gh.every((x) => !!x.etag)).toBe(true);
    expect(await prsOf(a.id)).toHaveLength(1);
    expect(await commitsOf(a.id)).toHaveLength(0);

    // a commit after the cursor: the commits are asked since the cursor
    lists['acme/app/commits'] = [commit(SHA1, `${a.key} fix\n\nbody`), commit(SHA2, 'chore')];
    gh = [];
    await poll();
    const c = gh.find((x) => x.url.pathname === '/repos/acme/app/commits')!;
    expect(c.url.searchParams.get('since')).toBeTruthy();
    expect((await commitsOf(a.id)).map((x) => x.sha)).toEqual([SHA1]);
    await poll();
    expect(await prsOf(a.id)).toHaveLength(1);
    expect(await commitsOf(a.id)).toHaveLength(1);
  });

  it('403 с исчерпанным лимитом: не падает, предупреждает, до сброса запросов нет', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const a = await mkTask();
    await connect();
    await bindRepo();
    lists['acme/app/pulls'] = [pr(3, `${a.key} лимит`)];
    const reset = Math.floor(Date.now() / 1000) + 600;
    fail['/repos/acme/app/pulls'] = () =>
      Response.json(
        { message: 'API rate limit exceeded' },
        {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
        },
      );
    gh = [];
    await expect(poll()).resolves.toBeUndefined();
    expect(ghPaths()).toEqual(['/repos/acme/app/pulls']);
    expect(Date.parse((await connection()).deferredUntil!)).toBe(reset * 1000);
    expect(warn.mock.calls.some(([m]) => /лимит/.test(String(m)))).toBe(true);
    const [b] = await db.select().from(R);
    expect(b!.lastError).toBe('rate_limited');
    expect(b!.syncedAt).toBeNull();

    // before the reset — no request through the connection
    delete fail['/repos/acme/app/pulls'];
    gh = [];
    await poll();
    expect(gh).toHaveLength(0);
    expect(await prsOf(a.id)).toHaveLength(0);

    // the reset passed — the poll goes on
    await db
      .update(G)
      .set({ deferredUntil: new Date(Date.now() - 1000).toISOString() })
      .where(eq(G.id, (await connection()).id));
    await poll();
    expect(gh.length).toBeGreaterThan(0);
    expect(await prsOf(a.id)).toHaveLength(1);
    expect((await connection()).deferredUntil).toBeNull();
  });

  it('429 с Retry-After: 60 — опрос отложен не меньше чем на 60 с', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await connect();
    await bindRepo();
    fail['/repos/acme/app/commits'] = () =>
      Response.json({ message: 'slow down' }, { status: 429, headers: { 'retry-after': '60' } });
    const before = Date.now();
    await expect(poll()).resolves.toBeUndefined();
    expect(Date.parse((await connection()).deferredUntil!)).toBeGreaterThanOrEqual(before + 60_000);
    gh = [];
    await poll();
    expect(gh).toHaveLength(0);
  });

  it('404 одного репозитория не мешает другому в том же цикле', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const a = await mkTask();
    await connect();
    const gone = await bindRepo('acme/app');
    const ok = await bindRepo('acme/lib');
    fail['/repos/acme/app/pulls'] = () => Response.json({ message: 'Not Found' }, { status: 404 });
    lists['acme/lib/pulls'] = [pr(7, `${a.key} lib`, 'acme/lib')];
    await expect(poll()).resolves.toBeUndefined();
    expect((await prsOf(a.id)).map((x) => [x.repoFullName, x.number])).toEqual([['acme/lib', 7]]);
    const [g] = await db.select().from(R).where(eq(R.id, gone));
    const [o] = await db.select().from(R).where(eq(R.id, ok));
    expect(g!.lastError).toBeTruthy();
    expect(g!.syncedAt).toBeNull();
    expect(o!.lastError).toBeNull();
    expect(o!.syncedAt).not.toBeNull();
    expect(warn.mock.calls.some(([m]) => String(m).includes('acme/app'))).toBe(true);
    expect((await connection()).deferredUntil).toBeNull();
  });
});
