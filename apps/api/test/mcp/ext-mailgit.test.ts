import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiTokenCreatedSchema } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { toolDefs } from '../../src/mcp/tools.js';
import { area } from '../../src/rest/ext/mailgit.js';
import { RestService } from '../../src/rest/rest.service.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, taskArgs, workspaceModule, world, type World } from '../sync/helpers.js';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { encrypt } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';

// PLNRAPP-279 (MG-1): mail preferences and GitLab branch / MR of a task over REST v1 and MCP, as the user
const PARITY_MAILGIT: Record<string, string> = {
  'GET /api/v1/me/email-prefs': 'get_email_prefs',
  'PUT /api/v1/me/email-prefs': 'set_email_prefs',
  'GET /api/v1/tasks/{task}/repos': 'list_task_repos',
  'POST /api/v1/tasks/{task}/branch': 'create_task_branch',
  'POST /api/v1/tasks/{task}/mr': 'create_task_mr',
};

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
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
  base = await app.getUrl();
  w = await world(db);
  await workspaceModule(db, 'email');
  admin = await issue(w.admin.userId, 'write');
  member = await issue(w.member.userId, 'write');
  read = await issue(w.admin.userId, 'read');
  outsider = await issue(w.outsider.userId, 'write');
});
afterAll(async () => {
  srv.close();
  kids.forEach((k) => k.kill());
  await app.close();
  await db.$client.end();
});

const kids: ReturnType<typeof spawn>[] = [];
async function mcp(secret: string) {
  const p = spawn(
    process.execPath,
    [new URL('./bridge.mjs', import.meta.url).pathname, `${base}/mcp`, secret],
    { cwd: new URL('../..', import.meta.url).pathname, stdio: ['pipe', 'pipe', 'inherit'] },
  );
  kids.push(p);
  const lines = createInterface({ input: p.stdout! })[Symbol.asyncIterator]();
  const next = async () => JSON.parse((await lines.next()).value as string);
  await next();
  let id = 0;
  return async (name: string, args: Record<string, unknown> = {}) => {
    p.stdin!.write(
      JSON.stringify({ id: ++id, method: 'callTool', params: { name, arguments: args } }) + '\n',
    );
    const r = await next();
    if (r.error) throw new Error(r.error);
    const res = r.result as { isError?: boolean; content: { text: string }[] };
    return [!!res.isError, JSON.parse(res.content[0]!.text)] as const;
  };
}

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

// mock GitLab: 42 = project; branch status / MR status are switchable
let hits: { path: string; method?: string; token: unknown; body?: Record<string, unknown> }[] = [];
let branchSt = 201;
let mrSt = 201;
const TOKEN = 'glpat-SECRET-token-value';
const srv = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const p = new URL(req.url!, 'http://x').pathname;
    hits.push({
      path: p,
      method: req.method,
      token: req.headers['private-token'],
      body: raw ? JSON.parse(raw) : undefined,
    });
    const send = (st: number, b: unknown) =>
      res.writeHead(st, { 'content-type': 'application/json' }).end(JSON.stringify(b));
    if (p === '/api/v4/projects/42')
      return send(200, { default_branch: 'main', web_url: 'https://gl/g' });
    if (p.endsWith('/repository/branches')) return send(branchSt, {});
    if (p.endsWith('/merge_requests')) return send(mrSt, { web_url: 'https://gl/mr/5' });
    send(404, {});
  });
});
let conn: string;
let key: string;
let tid: string;

async function connect(projectId: string) {
  const id = uuidv7();
  await db.$client.query(
    `insert into gitlab_connections (id, project_id, base_url, token_enc, gitlab_project_id, path)
     values ($1,$2,$3,$4,42,'g/p42')`,
    [
      id,
      projectId,
      `http://127.0.0.1:${(srv.address() as AddressInfo).port}`,
      encrypt(TOKEN, Buffer.from(process.env.PLANAR_SECRET_KEY!, 'base64')),
    ],
  );
  return id;
}

describe('почтовые предпочтения, ветка и MR (ext/mailgit)', () => {
  beforeAll(async () => {
    process.env.PLANAR_SECRET_KEY = randomBytes(32).toString('base64');
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    conn = await connect(w.projectId);
    tid = uuidv7();
    await w.admin.ok('task.create', taskArgs(w, { id: tid }));
    const { rows } = await db.$client.query(
      `select p.key || '-' || t.number as key from tasks t join projects p on p.id = t.project_id where t.id = $1`,
      [tid],
    );
    key = rows[0].key;
  });

  it('PARITY_MAILGIT равен операциям области; чтение — без write', () => {
    expect(
      Object.fromEntries(area.ops.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o.tool])),
    ).toEqual(PARITY_MAILGIT);
    const defs = toolDefs(app.get(RestService));
    for (const t of ['get_email_prefs', 'list_task_repos'])
      expect(defs.find((d) => d.name === t)?.write, t).toBe(false);
  });

  it('предпочтения: умолчания → изменить → прочитать; только свои', async () => {
    const call = await mcp(member);
    expect((await call('get_email_prefs'))[1]).toEqual({ notify: true, digest: false });
    const [e, r] = await call('set_email_prefs', { digest: true });
    expect([e, r], JSON.stringify(r)).toEqual([false, { notify: true, digest: true }]);
    expect((await rest(member, 'PUT', '/me/email-prefs', { notify: false }))[1].data).toEqual({
      notify: false,
      digest: true,
    });
    // admin's own prefs are untouched
    expect((await rest(admin, 'GET', '/me/email-prefs'))[1].data).toEqual({
      notify: true,
      digest: false,
    });
  });

  it('репозитории, ветка и MR: без токенов, имя ветки — ключ задачи', async () => {
    const call = await mcp(admin);
    const [e0, repos] = await call('list_task_repos', { task: key });
    expect([e0, repos]).toEqual([false, [{ id: conn, path: 'g/p42' }]]);
    expect(JSON.stringify(repos)).not.toContain(TOKEN);

    hits = [];
    const [e1, b] = await call('create_task_branch', { task: tid, connectionId: conn });
    expect([e1, b], JSON.stringify(b)).toEqual([false, { webUrl: `https://gl/g/-/tree/${key}` }]);
    expect(hits.find((h) => h.path.endsWith('/repository/branches'))).toMatchObject({
      token: TOKEN,
      body: { branch: key, ref: 'main' },
    });

    hits = [];
    const [e2, m] = await call('create_task_mr', { task: key });
    expect([e2, m], JSON.stringify(m)).toEqual([false, { webUrl: 'https://gl/mr/5' }]);
    expect(hits.at(-1)).toMatchObject({
      path: '/api/v4/projects/42/merge_requests',
      body: {
        source_branch: key,
        target_branch: 'main',
        title: expect.stringMatching(`^${key}: `),
      },
    });

    // branch exists (400) is not an error; MR exists (409) → conflict
    branchSt = 400;
    expect((await call('create_task_branch', { task: key }))[0]).toBe(false);
    mrSt = 409;
    const [e3, dup] = await call('create_task_mr', { task: key });
    expect([e3, dup.code]).toEqual([true, 'conflict']);
    branchSt = 201;
    mrSt = 201;
    expect((await rest(admin, 'POST', `/tasks/${tid}/branch`, {}))[0]).toBe(201);
    const [, bad] = await call('create_task_branch', { task: key, connectionId: uuidv7() });
    expect(bad.code).toBe('not_found');
  });

  it('отказы: чужой — not_found, гость и токен read — forbidden, модуль выключен — module_disabled', async () => {
    const out = await mcp(outsider);
    for (const [tool, args] of [
      ['list_task_repos', { task: tid }],
      ['create_task_branch', { task: tid }],
      ['create_task_mr', { task: tid }],
    ] as const) {
      const [e, r] = await out(tool, args);
      expect([tool, e, r.code]).toEqual([tool, true, 'not_found']);
    }
    const ro = await mcp(read);
    for (const o of area.ops.filter((x) => x.write)) {
      const [e, r] = await ro(o.tool, { task: tid, notify: false });
      expect([o.tool, e, r.code]).toEqual([o.tool, true, 'forbidden']);
    }
    expect((await ro('get_email_prefs'))[0]).toBe(false);
    expect((await ro('list_task_repos', { task: tid }))[0]).toBe(false);
    expect((await rest(read, 'POST', `/tasks/${tid}/mr`, {}))[0]).toBe(403);

    const guest = await issue(w.guest.userId, 'write');
    expect((await rest(guest, 'GET', `/tasks/${tid}/repos`))[0]).toBe(200);
    expect((await rest(guest, 'POST', `/tasks/${tid}/branch`, {}))[0]).toBe(403);

    const adm = await mcp(admin);
    const off = uuidv7();
    await w.admin.ok('project.create', {
      id: off,
      spaceId: w.spaceId,
      name: 'Off',
      key: 'OFFG',
      rank: 'a1',
      statusIds: Array.from({ length: 5 }, () => uuidv7()),
    });
    const t2 = uuidv7();
    await w.admin.ok('task.create', taskArgs(w, { id: t2, projectId: off }));
    await db.execute(sql`update projects set modules = '{}' where id = ${off}`);
    const [e, r] = await adm('list_task_repos', { task: t2 });
    expect([e, r.code]).toEqual([true, 'module_disabled']);
  });
});
