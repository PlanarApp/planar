// PLNRAPP-894: GitHub webhooks — the hook is registered on bind (a secret per binding, stored encrypted) and deleted
// on unbind; deliveries are checked by X-Hub-Signature-256 (401 without it / with a wrong one), push and pull_request
// put commits and PRs on the tasks at once, a repeated delivery adds nothing; GitHub is a mocked fetch
import { createHmac, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { decrypt } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import {
  githubChoices as C,
  githubCommits as GC,
  githubConnections as G,
  githubPrs as GP,
  githubRepos as R,
} from '@planar/module-github/api/schema';
import { GITHUB_ERRORS } from '@planar/module-github/shared';
import { tasks } from '../../src/db/schema.js';
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { taskArgs, world, type World } from '../sync/helpers.js';

useApp();

const WS = '00000000-0000-0000-0000-000000000000';
const KEY = randomBytes(32).toString('base64');
const REPO = { id: 3_000_000_894, full_name: 'acme/app', default_branch: 'main', private: true };
const HOOK_ID = 4242;
const SHA1 = '0123456789abcdef0123456789abcdef01234567';
const SHA2 = 'fedcba9876543210fedcba9876543210fedcba98';
let w: World;
let cookie: string;
let gh: { method: string; path: string; body: Record<string, unknown> | null }[];
let hookStatus: number;
let deleteStatus: number;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  w = await world(db);
  cookie = await loginCookie(db, (await createUser(db, { role: 'admin' })).id);
});
beforeEach(async () => {
  process.env.PLANAR_SECRET_KEY = KEY;
  gh = [];
  hookStatus = 201;
  deleteStatus = 204;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.github.com/')) return realFetch(input, init);
    const method = init?.method ?? 'GET';
    const path = new URL(url).pathname;
    gh.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (path === '/user') return Response.json({ login: 'octo', id: 1 });
    if (path === '/repos/acme/app') return Response.json(REPO);
    if (path === '/repos/acme/app/hooks' && method === 'POST')
      return hookStatus === 201
        ? Response.json({ id: HOOK_ID, active: true }, { status: 201 })
        : Response.json({ message: 'Not Found' }, { status: hookStatus });
    if (path === `/repos/acme/app/hooks/${HOOK_ID}` && method === 'DELETE')
      return deleteStatus === 204
        ? new Response(null, { status: 204 })
        : Response.json({ message: 'Not Found' }, { status: deleteStatus });
    return Response.json({ message: 'Not Found' }, { status: 404 });
  });
  await db.delete(GP);
  await db.delete(GC);
  await db.delete(R);
  await db.delete(C);
  await db.delete(G);
});
afterEach(() => vi.restoreAllMocks());

const app = () => getApp().getHttpAdapter().getInstance();
const call = (method: string, url: string, body?: unknown) =>
  app().inject({
    method: method as 'GET',
    url: `/api/github/${url}`,
    payload: body as object | undefined,
    headers: { cookie, origin: ORIGIN },
  });
const bindRepo = async () => {
  expect(
    (await call('POST', 'connections', { scope: 'workspace', scopeId: WS, token: 'ghp_x' }))
      .statusCode,
  ).toBe(201);
  gh = [];
  const r = await call('POST', `projects/${w.projectId}/repos`, { fullName: 'acme/app' });
  expect(r.statusCode).toBe(201);
  return r.json().repo as { id: string; hook: boolean; hookError: string | null };
};
/** The secret GitHub was given when the hook was created. */
const secretSent = () =>
  (
    gh.find((x) => x.method === 'POST' && x.path === '/repos/acme/app/hooks')!.body!.config as {
      secret: string;
    }
  ).secret;
const sign = (secret: string, raw: string) =>
  `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
/** A delivery as GitHub sends it: the raw JSON body, signed by `secret` (null — no signature header). */
const deliver = (
  bindingId: string,
  event: string,
  body: unknown,
  secret: string | null,
  delivery = uuidv7(),
  signature?: string,
) => {
  const raw = JSON.stringify(body);
  return app().inject({
    method: 'POST',
    url: `/api/github/webhook/${bindingId}`,
    payload: raw,
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': delivery,
      ...(secret === null ? {} : { 'x-hub-signature-256': signature ?? sign(secret, raw) }),
    },
  });
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
const prEvent = (
  action: string,
  number: number,
  title: string,
  o: Record<string, unknown> = {},
) => ({
  action,
  number,
  pull_request: {
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
  },
  repository: { id: REPO.id, full_name: REPO.full_name },
});
const pushEvent = (...commits: [string, string][]) => ({
  ref: 'refs/heads/feature/x',
  deleted: false,
  commits: commits.map(([id, message]) => ({
    id,
    message,
    timestamp: '2026-11-28T09:00:00+03:00',
    url: `https://github.com/acme/app/commit/${id}`,
    author: { name: 'Octo Cat', username: 'octo' },
  })),
  repository: { id: REPO.id, full_name: REPO.full_name },
});
const prsOf = (taskId: string) => db.select().from(GP).where(eq(GP.taskId, taskId));
const commitsOf = (taskId: string) => db.select().from(GC).where(eq(GC.taskId, taskId));

describe('github: вебхуки', () => {
  it('привязка создаёт хук push + pull_request с секретом привязки, секрет в БД зашифрован', async () => {
    const repo = await bindRepo();
    expect(repo).toMatchObject({ hook: true, hookError: null });
    const post = gh.find((x) => x.method === 'POST' && x.path === '/repos/acme/app/hooks')!;
    expect(post.body).toMatchObject({
      name: 'web',
      active: true,
      events: ['push', 'pull_request'],
      config: { content_type: 'json' },
    });
    const cfg = post.body!.config as { url: string; secret: string };
    expect(cfg.url).toMatch(new RegExp(`/api/github/webhook/${repo.id}$`));
    expect(cfg.secret.length).toBeGreaterThanOrEqual(32);
    const [row] = await db.select().from(R).where(eq(R.id, repo.id));
    expect(row!.hookId).toBe(HOOK_ID);
    expect(row!.hookSecretEnc).toBeTruthy();
    expect(row!.hookSecretEnc).not.toBe(cfg.secret);
    expect(row!.hookSecretEnc).not.toContain(cfg.secret);
    expect(decrypt(row!.hookSecretEnc!, Buffer.from(KEY, 'base64'))).toBe(cfg.secret);
    // a rebind keeps the hook: no second one
    gh = [];
    expect(
      (await call('POST', `projects/${w.projectId}/repos`, { fullName: 'acme/app' })).json().repo,
    ).toMatchObject({ hook: true });
    expect(gh.filter((x) => x.path.endsWith('/hooks'))).toHaveLength(0);
  });

  it('отвязка удаляет хук; 404 от GitHub не мешает отвязке', async () => {
    const repo = await bindRepo();
    gh = [];
    expect((await call('DELETE', `repos/${repo.id}`)).statusCode).toBe(204);
    expect(gh).toEqual([
      { method: 'DELETE', path: `/repos/acme/app/hooks/${HOOK_ID}`, body: null },
    ]);
    const again = await bindRepo();
    deleteStatus = 404;
    expect((await call('DELETE', `repos/${again.id}`)).statusCode).toBe(204);
    expect(await db.select().from(R)).toHaveLength(0);
  });

  it.each([403, 404])(
    'нет прав на хук (%i): привязка сохраняется с предупреждением',
    async (st) => {
      hookStatus = st;
      const repo = await bindRepo();
      expect(repo).toMatchObject({ hook: false, hookError: GITHUB_ERRORS.hookNoRights });
      const list = (await call('GET', `projects/${w.projectId}/repos`)).json().repos;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ hook: false, hookError: GITHUB_ERRORS.hookNoRights });
      // no hook — nothing to delete on unbind
      gh = [];
      expect((await call('DELETE', `repos/${repo.id}`)).statusCode).toBe(204);
      expect(gh).toHaveLength(0);
    },
  );

  it('подпись: без заголовка, неверная, чужим секретом, неизвестная привязка — 401, ничего не создано', async () => {
    const a = await mkTask();
    const repo = await bindRepo();
    const secret = secretSent();
    const ev = prEvent('opened', 1, `${a.key} webhook`);
    const no = await deliver(repo.id, 'pull_request', ev, null);
    expect(no.statusCode).toBe(401);
    expect(
      (await deliver(repo.id, 'pull_request', ev, secret, uuidv7(), 'sha256=00')).statusCode,
    ).toBe(401);
    expect((await deliver(repo.id, 'pull_request', ev, 'another-secret')).statusCode).toBe(401);
    // signed for another body
    expect(
      (await deliver(repo.id, 'pull_request', ev, secret, uuidv7(), sign(secret, '{}'))).statusCode,
    ).toBe(401);
    expect((await deliver(uuidv7(), 'pull_request', ev, secret)).statusCode).toBe(401);
    expect((await deliver('not-a-uuid', 'pull_request', ev, secret)).statusCode).toBe(401);
    expect(await prsOf(a.id)).toHaveLength(0);
    // the right signature — 2xx, the PR is on the task
    expect((await deliver(repo.id, 'pull_request', ev, secret)).statusCode).toBe(200);
    expect(await prsOf(a.id)).toHaveLength(1);
  });

  it('ping и прочие события — 200 без обработки', async () => {
    const repo = await bindRepo();
    const secret = secretSent();
    const ping = await deliver(
      repo.id,
      'ping',
      { zen: 'Keep it simple.', hook_id: HOOK_ID },
      secret,
    );
    expect(ping.statusCode).toBe(200);
    expect(ping.json()).toEqual({ ok: true, event: 'ping', applied: false });
    const star = await deliver(repo.id, 'star', { action: 'created' }, secret);
    expect(star.statusCode).toBe(200);
    expect(star.json().applied).toBe(false);
  });

  it('pull_request: PR сразу в задаче, merge — merged, повторная доставка без дубля', async () => {
    const a = await mkTask();
    const repo = await bindRepo();
    const secret = secretSent();
    const opened = prEvent('opened', 7, `${a.key} фича`);
    const t0 = Date.now();
    const r = await deliver(repo.id, 'pull_request', opened, secret, 'delivery-1');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, event: 'pull_request', applied: true });
    // applied within the request: on the task right after the answer
    let rows = await prsOf(a.id);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      number: 7,
      state: 'open',
      repoFullName: 'acme/app',
      webUrl: 'https://github.com/acme/app/pull/7',
    });
    // the same delivery again
    expect((await deliver(repo.id, 'pull_request', opened, secret, 'delivery-1')).statusCode).toBe(
      200,
    );
    expect(await prsOf(a.id)).toHaveLength(1);

    const merged = prEvent('closed', 7, `${a.key} фича`, {
      state: 'closed',
      merged_at: '2026-11-28T11:00:00Z',
      updated_at: '2026-11-28T11:00:00Z',
    });
    expect((await deliver(repo.id, 'pull_request', merged, secret)).statusCode).toBe(200);
    rows = await prsOf(a.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe('merged');
    // a late delivery of an older state does not roll the PR back
    expect((await deliver(repo.id, 'pull_request', opened, secret)).json().applied).toBe(false);
    expect((await prsOf(a.id))[0]!.state).toBe('merged');
    // webhook deliveries make no GitHub requests
    expect(gh.filter((x) => !x.path.endsWith('/hooks') && x.path !== '/repos/acme/app')).toEqual(
      [],
    );
  });

  it('push: коммит с ключом в задаче, без ключа — нет; повторная доставка без дубля', async () => {
    const a = await mkTask();
    const repo = await bindRepo();
    const secret = secretSent();
    const ev = pushEvent([SHA1, `${a.key} fix\n\nbody`], [SHA2, 'chore: nothing']);
    const r = await deliver(repo.id, 'push', ev, secret, 'delivery-2');
    expect(r.statusCode).toBe(200);
    expect(r.json().applied).toBe(true);
    let rows = await commitsOf(a.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sha: SHA1,
      message: `${a.key} fix`,
      authorName: 'Octo Cat',
      webUrl: `https://github.com/acme/app/commit/${SHA1}`,
    });
    expect((await deliver(repo.id, 'push', ev, secret, 'delivery-2')).statusCode).toBe(200);
    rows = await commitsOf(a.id);
    expect(rows).toHaveLength(1);
    expect(await db.select().from(GC)).toHaveLength(1);
  });
});
