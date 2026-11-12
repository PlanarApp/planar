// PLNRAPP-167: module ai — the bot «ИИ», connections with inheritance, the AI SDK wrapper.
// The provider is a local fake of an OpenAI-compatible server: no network, the real SDK code path.
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decrypt } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import { generateStructured, resolveConnection, secretOf } from '@planar/module-ai/api';
import { aiConnections as C } from '@planar/module-ai/api/schema';
import { hashPassword } from '../../src/auth/password.js';
import { notifications, spaceMembers, users } from '../../src/db/schema.js';
import { remindDue } from '../../src/jobs/due.js';
import { ensureSystemUser } from '../../src/users/system.js';
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { taskArgs, world, type World } from '../sync/helpers.js';

useApp();

const KEY = randomBytes(32).toString('base64');
const SECRET = 'sk-SECRET-provider-key';
let w: World;
let srv: http.Server;
let base: string;
let hits: { path: string; auth: string | undefined; body: Record<string, unknown> }[] = [];
let status = 200;
const cookies: Record<string, string> = {};

beforeAll(async () => {
  process.env.PLANAR_SECRET_KEY = KEY;
  w = await world(db);
  cookies.root = await loginCookie(db, (await createUser(db, { role: 'admin' })).id);
  cookies.spaceAdmin = await loginCookie(db, w.admin.userId);
  cookies.member = await loginCookie(db, w.member.userId);
  cookies.outsider = await loginCookie(db, w.outsider.userId);
  srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      hits.push({
        path: req.url!,
        auth: req.headers.authorization,
        body: raw ? JSON.parse(raw) : {},
      });
      if (status !== 200) return void res.writeHead(status).end('{"error":{"message":"no"}}');
      if (req.url === '/models')
        return void res
          .writeHead(200, { 'content-type': 'application/json' })
          .end('{"data":[{"id":"fake-2"},{"id":"fake-1"},{"id":"fake-1"},{"x":1}]}');
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          id: 'c1',
          object: 'chat.completion',
          created: 1,
          model: 'fake',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '{"answer":"42"}' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
        }),
      );
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(() => void srv.close());
beforeEach(async () => {
  hits = [];
  status = 200;
  await db.delete(C);
});

const call = (method: string, url: string, who: string, body?: unknown) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: method as 'GET',
      url: `/api/ai/${url}`,
      payload: body as object | undefined,
      headers: { cookie: cookies[who]!, origin: ORIGIN },
    });
const put = (who: string, scope: string, scopeId?: string, over: Record<string, unknown> = {}) =>
  call('PUT', 'connections', who, {
    scope,
    scopeId,
    provider: 'openai-compatible',
    baseUrl: base,
    apiKey: SECRET,
    model: 'fake-1',
    priceIn: 2,
    priceOut: 10,
    ...over,
  });
const list = (who: string, scope: string, scopeId?: string) =>
  call('GET', `connections?scope=${scope}${scopeId ? `&scopeId=${scopeId}` : ''}`, who);

describe('ai: подключения', () => {
  it('ключ шифруется, наружу не отдаётся, проверка связи идёт с этим ключом', async () => {
    const r = await put('root', 'workspace');
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain(SECRET);
    expect(r.json().connection).toMatchObject({
      scope: 'workspace',
      model: 'fake-1',
      keySet: true,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ path: '/chat/completions', auth: `Bearer ${SECRET}` });
    const [row] = await db.select().from(C);
    expect(row!.keyEnc).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(row!.keyEnc).not.toContain(SECRET);
    expect(decrypt(row!.keyEnc, Buffer.from(KEY, 'base64'))).toBe(SECRET);
    const g = await list('root', 'workspace');
    expect(g.body).not.toContain(SECRET);
    expect(g.body).not.toContain('keyEnc');
    expect(g.json().connection.id).toBe(row!.id);
  });

  it('провайдер отклонил ключ или недоступен — 502, ничего не сохранено, текст провайдера не уходит', async () => {
    for (const st of [401, 500]) {
      status = st;
      const r = await put('root', 'workspace');
      expect(r.statusCode).toBe(502);
      expect(r.body).not.toContain('"no"');
    }
    expect(await db.select().from(C)).toHaveLength(0);
  });

  it('список моделей: с ключом формы или сохранённым того же адреса; ошибки — 502; только админ', async () => {
    const body = { scope: 'workspace', provider: 'openai-compatible', baseUrl: base };
    const r = await call('POST', 'connections/models', 'root', { ...body, apiKey: 'k-form' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ models: ['fake-1', 'fake-2'] });
    expect(hits.at(-1)).toMatchObject({ path: '/models', auth: 'Bearer k-form' });
    // nothing saved yet — no key
    expect((await call('POST', 'connections/models', 'root', body)).statusCode).toBe(400);
    await put('root', 'workspace');
    expect((await call('POST', 'connections/models', 'root', body)).statusCode).toBe(200);
    expect(hits.at(-1)!.auth).toBe(`Bearer ${SECRET}`);
    // another host — the saved key is not sent there
    const other = { ...body, baseUrl: `${base}/other` };
    expect((await call('POST', 'connections/models', 'root', other)).statusCode).toBe(400);
    status = 401;
    const bad = await call('POST', 'connections/models', 'root', body);
    expect(bad.statusCode).toBe(502);
    expect(bad.body).not.toContain('"no"');
    status = 200;
    const m = { ...body, scope: 'space', scopeId: w.spaceId, apiKey: 'k' };
    expect((await call('POST', 'connections/models', 'member', m)).statusCode).toBe(403);
  });

  it('смена модели без ключа оставляет сохранённый ключ и проверяет им', async () => {
    await put('root', 'workspace');
    hits = [];
    const r = await put('root', 'workspace', undefined, { apiKey: undefined, model: 'fake-2' });
    expect(r.statusCode).toBe(200);
    expect(hits[0]!.auth).toBe(`Bearer ${SECRET}`);
    const rows = await db.select().from(C);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.model).toBe('fake-2');
    expect((await put('root', 'space', w.spaceId, { apiKey: undefined })).statusCode).toBe(400);
  });

  it('наследование: ближайший уровень — проект, затем пространство, затем воркспейс', async () => {
    expect(await resolveConnection(db, w.projectId)).toBeNull();
    await put('root', 'workspace', undefined, { model: 'm-instance' });
    expect((await resolveConnection(db, w.projectId))!.model).toBe('m-instance');
    await put('spaceAdmin', 'space', w.spaceId, { model: 'm-space' });
    expect((await resolveConnection(db, w.projectId))!.model).toBe('m-space');
    await put('spaceAdmin', 'project', w.projectId, { model: 'm-project' });
    const own = await resolveConnection(db, w.projectId);
    expect(own!.model).toBe('m-project');
    expect(secretOf(own!).apiKey).toBe(SECRET);

    // another project of the same space and a project of another space
    const p2 = uuidv7();
    await w.admin.ok('project.create', {
      id: p2,
      spaceId: w.spaceId,
      name: 'P2',
      key: 'PTWO',
      rank: 'b0',
    });
    expect((await resolveConnection(db, p2))!.model).toBe('m-space');
    const w2 = await world(db);
    expect((await resolveConnection(db, w2.projectId))!.model).toBe('m-instance');

    // the UI sees what is in force when the level has no connection of its own
    const g = (await list('spaceAdmin', 'project', p2)).json();
    expect(g.connection).toBeNull();
    expect(g.effective).toMatchObject({ scope: 'space', model: 'm-space' });
    expect((await list('spaceAdmin', 'space', w.spaceId)).json().connection.model).toBe('m-space');

    // removing the nearest level falls back to the next one
    const id = (await list('spaceAdmin', 'project', w.projectId)).json().connection.id;
    expect((await call('DELETE', `connections/${id}`, 'spaceAdmin')).statusCode).toBe(204);
    expect((await resolveConnection(db, w.projectId))!.model).toBe('m-space');
  });

  it('права: воркспейс — админ инстанса, пространство и проект — их админы; проект — только с модулем', async () => {
    expect((await put('member', 'workspace')).statusCode).toBe(403);
    expect((await put('spaceAdmin', 'workspace')).statusCode).toBe(403);
    expect((await put('member', 'space', w.spaceId)).statusCode).toBe(403);
    expect((await put('member', 'project', w.projectId)).statusCode).toBe(403);
    expect((await put('outsider', 'project', w.projectId)).statusCode).toBe(403);
    expect((await put('spaceAdmin', 'space', uuidv7())).statusCode).toBe(404);
    expect((await list('member', 'workspace')).statusCode).toBe(403);
    expect((await put('root', 'project', w.projectId)).statusCode).toBe(200);
    // module off in the project: no project connection, but the space one is still allowed
    await w.admin.ok('project.setModule', {
      projectId: w.projectId,
      moduleId: 'ai',
      enabled: false,
    });
    expect((await put('root', 'project', w.projectId)).statusCode).toBe(403);
    expect((await put('spaceAdmin', 'space', w.spaceId)).statusCode).toBe(200);
    await w.admin.ok('project.setModule', {
      projectId: w.projectId,
      moduleId: 'ai',
      enabled: true,
    });
    // a body that breaks the form
    expect((await put('root', 'workspace', undefined, { provider: 'nope' })).statusCode).toBe(400);
    expect((await put('root', 'workspace', undefined, { baseUrl: null })).statusCode).toBe(400);
    expect((await put('root', 'space')).statusCode).toBe(400);
    // PLNRAPP-193: the former level name is not accepted
    expect((await put('root', 'instance')).statusCode).toBe(400);
    expect((await list('root', 'instance')).statusCode).toBe(400);
    const id = (await list('root', 'project', w.projectId)).json().connection.id;
    expect((await call('DELETE', `connections/${id}`, 'member')).statusCode).toBe(403);
    expect((await call('DELETE', `connections/nope`, 'root')).statusCode).toBe(404);
  });

  it('generateStructured: объект по схеме, токены и стоимость', async () => {
    await put('root', 'workspace');
    hits = [];
    const conn = secretOf((await resolveConnection(db, w.projectId))!);
    const r = await generateStructured(conn, {
      schema: z.object({ answer: z.string() }),
      prompt: 'q',
    });
    expect(r.object).toEqual({ answer: '42' });
    // 1000 in × $2 + 500 out × $10, per 1M tokens
    expect(r.usage).toEqual({ inputTokens: 1000, outputTokens: 500, cost: 0.007 });
    expect(hits[0]!.auth).toBe(`Bearer ${SECRET}`);
    const free = await generateStructured(
      { ...conn, priceIn: null, priceOut: null },
      { schema: z.object({ answer: z.string() }), prompt: 'q' },
    );
    expect(free.usage.cost).toBeNull();
  });
});

describe('ai: бот «ИИ»', () => {
  const bot = async () => (await db.select().from(users).where(eq(users.login, 'ai')))[0]!;

  it('включение модуля создаёт активного бота, участника пространства с ролью member; повтор не дублирует', async () => {
    const b = await bot();
    expect(b).toMatchObject({ name: 'ИИ', bot: true, deactivatedAt: null, role: 'member' });
    const m = await db
      .select()
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, w.spaceId), eq(spaceMembers.userId, b.id)));
    expect(m).toHaveLength(1);
    expect(m[0]!.role).toBe('member');
    // the bot is on the wire (pickers see it) and is flagged
    const boot = await w.member.bootstrap();
    const wire = JSON.stringify(boot);
    expect(wire).toContain(b.id);
    expect(wire).not.toContain('passwordHash');
    // off and on again: still one bot, still one membership
    await w.admin.ok('project.setModule', {
      projectId: w.projectId,
      moduleId: 'ai',
      enabled: false,
    });
    await w.admin.ok('project.setModule', {
      projectId: w.projectId,
      moduleId: 'ai',
      enabled: true,
    });
    expect(await db.select().from(users).where(eq(users.login, 'ai'))).toHaveLength(1);
    expect(
      await db
        .select()
        .from(spaceMembers)
        .where(and(eq(spaceMembers.spaceId, w.spaceId), eq(spaceMembers.userId, b.id))),
    ).toHaveLength(1);
  });

  it('занятый обычным пользователем логин ai — ошибка, а не чужой бот', async () => {
    await createUser(db, { login: 'human-ai' });
    await expect(ensureSystemUser(db, 'human-ai', 'ИИ', true)).rejects.toThrow(/занят/);
  });

  it('входа нет: даже с верным паролем вход отклоняется по флагу', async () => {
    const b = await bot();
    await db
      .update(users)
      .set({ passwordHash: await hashPassword('secret-pass') })
      .where(eq(users.id, b.id));
    const r = await getApp()
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { login: 'ai', password: 'secret-pass' },
        headers: { origin: ORIGIN },
      });
    expect(r.statusCode).toBe(401);
    expect(r.headers['set-cookie']).toBeUndefined();
    // the owner cannot sign in as the bot either
    const owner = await createUser(db, { role: 'owner' });
    const imp = await getApp()
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/auth/impersonate',
        payload: { userId: b.id },
        headers: { cookie: await loginCookie(db, owner.id), origin: ORIGIN },
      });
    expect(imp.statusCode).toBe(401);
  });

  it('исключения: нет напоминаний о сроке и уведомлений о назначении и упоминании', async () => {
    const b = await bot();
    const due = taskArgs(w, { dueDate: '2026-11-12', assignees: [{ id: uuidv7(), userId: b.id }] });
    await w.admin.ok('task.create', due);
    await w.admin.ok('task.assign', { id: uuidv7(), taskId: due.id, userId: w.member.userId });
    await w.admin.ok('comment.create', {
      id: uuidv7(),
      taskId: due.id,
      body: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'mention', attrs: { id: b.id, label: 'ИИ' } }] },
        ],
      },
      assigneeId: b.id,
    });
    const ids = await remindDue(db, w.admin.userId, new Date('2026-11-12T09:30:00Z'));
    const rows = await db.select().from(notifications).where(eq(notifications.userId, b.id));
    expect(rows).toEqual([]);
    expect(ids.length).toBeGreaterThan(0); // the person got his reminder, the bot did not
    const mine = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, w.member.userId));
    expect(mine.map((n) => n.kind)).toContain('due_today');
  });

  it('зависимость: ai включает automations, выключение automations выключает ai', async () => {
    const p = uuidv7();
    await w.admin.ok('project.create', {
      id: p,
      spaceId: w.spaceId,
      name: 'D',
      key: 'PDEP',
      rank: 'c0',
    });
    const mods = async () =>
      (await db.$client.query('select modules from projects where id = $1', [p])).rows[0]
        .modules as string[];
    for (const m of await mods())
      await w.admin.ok('project.setModule', { projectId: p, moduleId: m, enabled: false });
    expect(await mods()).toEqual([]);
    await w.admin.ok('project.setModule', { projectId: p, moduleId: 'ai', enabled: true });
    expect((await mods()).sort()).toEqual(['ai', 'automations']);
    await w.admin.ok('project.setModule', {
      projectId: p,
      moduleId: 'automations',
      enabled: false,
    });
    expect(await mods()).toEqual([]);
  });
});
