// PLNRAPP-892: PRs and commits of a bound GitHub repository on the tasks — the one-off sync of the project
// (admin) and of the task's tab (project access), links by the key, statuses, no duplicates, unbinding and task
// deletion clean up; GitHub is a mocked fetch
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@planar/shared';
import {
  githubChoices as C,
  githubCommits as GC,
  githubConnections as G,
  githubPrs as GP,
  githubRepos as R,
} from '@planar/module-github/api/schema';
import { tasks } from '../../src/db/schema.js';
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { taskArgs, world, type World } from '../sync/helpers.js';

useApp();

const WS = '00000000-0000-0000-0000-000000000000';
const KEY = randomBytes(32).toString('base64');
const REPO = { id: 3_000_000_777, full_name: 'acme/app', default_branch: 'main', private: true };
const SHA1 = '0123456789abcdef0123456789abcdef01234567';
const SHA2 = 'fedcba9876543210fedcba9876543210fedcba98';
let w: World;
let cookie: string;
let pulls: Record<string, unknown>[];
let commits: Record<string, unknown>[];
let gh: string[];
const realFetch = globalThis.fetch;

beforeAll(async () => {
  w = await world(db);
  cookie = await loginCookie(db, (await createUser(db, { role: 'admin' })).id);
});
beforeEach(async () => {
  process.env.PLANAR_SECRET_KEY = KEY;
  gh = [];
  pulls = [];
  commits = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.github.com/')) return realFetch(input, init);
    gh.push(url);
    const u = new URL(url);
    if (u.pathname === '/user') return Response.json({ login: 'octo', id: 1 });
    if (u.pathname === '/repos/acme/app') return Response.json(REPO);
    if (u.pathname === '/repos/acme/app/pulls') return Response.json(pulls);
    if (u.pathname === '/repos/acme/app/commits') return Response.json(commits);
    return Response.json({ message: 'Not Found' }, { status: 404 });
  });
  await db.delete(GP);
  await db.delete(GC);
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
const bindRepo = async () => {
  expect(
    (await call('POST', 'connections', { scope: 'workspace', scopeId: WS, token: 'ghp_x' }))
      .statusCode,
  ).toBe(201);
  const r = await call('POST', `projects/${w.projectId}/repos`, { fullName: 'acme/app' });
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
const pr = (number: number, title: string, o: Record<string, unknown> = {}) => ({
  number,
  title,
  state: 'open',
  draft: false,
  merged_at: null,
  html_url: `https://github.com/acme/app/pull/${number}`,
  updated_at: '2026-11-28T10:00:00Z',
  head: { ref: 'feature/x' },
  user: { login: 'octo' },
  ...o,
});
const commit = (sha: string, message: string) => ({
  sha,
  html_url: `https://github.com/acme/app/commit/${sha}`,
  commit: { message, author: { name: 'Octo Cat', date: '2026-11-28T09:00:00Z' } },
});
const syncProject = () => call('POST', `projects/${w.projectId}/sync`);
const prsOf = (taskId: string) => db.select().from(GP).where(eq(GP.taskId, taskId));
const commitsOf = (taskId: string) => db.select().from(GC).where(eq(GC.taskId, taskId));

describe('github: PR и коммиты в задаче', () => {
  it('PR по ключу в заголовке и в ветке, коммит по ключу; статус меняется, дублей нет', async () => {
    const a = await mkTask();
    const b = await mkTask();
    await bindRepo();
    pulls = [
      pr(1, `${a.key} тест`),
      pr(2, 'no key in the title', { head: { ref: `feature/${a.key}-x` } }),
      pr(3, `${a.key} ${b.key}`),
      pr(4, 'unrelated'),
    ];
    commits = [commit(SHA1, `${a.key} fix\n\nbody`), commit(SHA2, 'chore: nothing')];
    gh = [];
    const r = await syncProject();
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ prs: 3, commits: 1 });
    expect(gh.map((u) => new URL(u).pathname)).toEqual([
      '/repos/acme/app/pulls',
      '/repos/acme/app/commits',
    ]);
    const ap = await prsOf(a.id);
    expect(ap.map((x) => x.number).sort()).toEqual([1, 2, 3]);
    expect(ap.find((x) => x.number === 1)).toMatchObject({
      spaceId: w.spaceId,
      repoId: REPO.id,
      repoFullName: 'acme/app',
      title: `${a.key} тест`,
      state: 'open',
      webUrl: 'https://github.com/acme/app/pull/1',
      authorLogin: 'octo',
    });
    expect((await prsOf(b.id)).map((x) => x.number)).toEqual([3]);
    const ac = await commitsOf(a.id);
    expect(ac).toHaveLength(1);
    expect(ac[0]).toMatchObject({ sha: SHA1, message: `${a.key} fix`, authorName: 'Octo Cat' });

    pulls[0] = pr(1, `${a.key} тест`, { state: 'closed', merged_at: '2026-11-28T11:00:00Z' });
    expect((await syncProject()).json()).toEqual({ prs: 3, commits: 1 });
    await syncProject();
    const again = await prsOf(a.id);
    expect(again).toHaveLength(3);
    expect(again.find((x) => x.number === 1)!.state).toBe('merged');
    expect(await commitsOf(a.id)).toHaveLength(1);
  });

  it('вкладка задачи: синхронизация для участника проекта; посторонний — 404', async () => {
    const a = await mkTask();
    await bindRepo();
    pulls = [pr(5, `${a.key} from the tab`)];
    const member = { cookie: await loginCookie(db, w.member.userId) };
    const outsider = { cookie: await loginCookie(db, w.outsider.userId) };
    expect((await call('POST', `tasks/${a.id}/sync`, undefined, outsider)).statusCode).toBe(404);
    const r = await call('POST', `tasks/${a.id}/sync`, undefined, member);
    expect(r.statusCode).toBe(200);
    expect(await prsOf(a.id)).toHaveLength(1);
    expect((await call('POST', `tasks/${uuidv7()}/sync`, undefined, member)).statusCode).toBe(404);
    // the project's sync is the admin's
    expect((await call('POST', `projects/${w.projectId}/sync`, undefined, member)).statusCode).toBe(
      403,
    );
  });

  it('отвязка репозитория и удаление задачи убирают её PR и коммиты', async () => {
    const a = await mkTask();
    const b = await mkTask();
    const repo = await bindRepo();
    pulls = [pr(6, `${a.key} ${b.key}`)];
    commits = [commit(SHA1, `${b.key} fix`)];
    await syncProject();
    await w.admin.ok('task.delete', { id: b.id });
    expect(await prsOf(b.id)).toHaveLength(0);
    expect(await commitsOf(b.id)).toHaveLength(0);
    expect(await prsOf(a.id)).toHaveLength(1);
    expect((await call('DELETE', `repos/${repo}`)).statusCode).toBe(204);
    expect(await db.select().from(GP)).toHaveLength(0);
  });
});
