import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { apiTokenCreatedSchema, uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import * as schema from '../../src/db/schema.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, world, type World } from '../sync/helpers.js';

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
let w: World;
let write: { secret: string; id: string };
let read: { secret: string; id: string };
let outsider: { secret: string; id: string };
let adminCookie: string;

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
  const b = apiTokenCreatedSchema.parse(r.json());
  return { secret: b.secret, id: b.token.id };
}

beforeAll(async () => {
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN });
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/mcp`;
  w = await world(db);
  write = await issue(w.member.userId, 'write');
  read = await issue(w.member.userId, 'read');
  outsider = await issue(w.outsider.userId, 'write');
  adminCookie = await loginCookie(db, w.admin.userId);
});
afterAll(async () => {
  kids.forEach((k) => k.kill());
  await app.close();
  await db.$client.end();
});

/** клиент SDK (Client + StreamableHTTPClientTransport) в дочернем процессе, см. bridge.mjs */
type Client = ReturnType<typeof bridge> extends Promise<infer C> ? C : never;
const kids: ReturnType<typeof spawn>[] = [];
async function bridge(secret: string) {
  const p = spawn(
    process.execPath,
    [new URL('./bridge.mjs', import.meta.url).pathname, base, secret],
    {
      cwd: new URL('../..', import.meta.url).pathname,
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  );
  kids.push(p);
  const lines = createInterface({ input: p.stdout! })[Symbol.asyncIterator]();
  const next = async () => JSON.parse((await lines.next()).value as string);
  const hello = await next();
  if (hello.error) throw new Error(hello.error);
  let id = 0;
  const rpc = async (method: string, params?: unknown) => {
    p.stdin!.write(JSON.stringify({ id: ++id, method, params }) + '\n');
    const r = await next();
    if (r.error) throw new Error(r.error);
    return r.result;
  };
  return {
    listTools: () =>
      rpc('listTools') as Promise<{ tools: { name: string; inputSchema: { type: string } }[] }>,
    callTool: (a: { name: string; arguments: object }) => rpc('callTool', a),
    close: async () => void p.kill(),
  };
}
const connect = bridge;
/** вызов инструмента → [isError, разобранный JSON] */
async function call(c: Client, name: string, args: Record<string, unknown> = {}) {
  const r = (await c.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { text: string }[];
  };
  return [!!r.isError, JSON.parse(r.content[0]!.text)] as const;
}
const mk = async (c: Client, title: string, extra = {}) => {
  const [err, t] = await call(c, 'create_task', { projectId: w.projectId, title, ...extra });
  expect(err, JSON.stringify(t)).toBe(false);
  return t as { id: string; key: string; description: string | null; statusId: string };
};

describe('MCP /mcp', () => {
  it('initialize и tools/list: 9 инструментов со схемами', async () => {
    const c = await connect(write.secret);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'add_comment',
        'create_task',
        'get_task',
        'list_fields',
        'list_projects',
        'list_spaces',
        'my_tasks',
        'search_tasks',
        'update_task',
      ].sort(),
    );
    for (const t of tools) expect(t.inputSchema.type).toBe('object');
    await c.close();
  });

  it('без токена → 401, cookie вместо токена → 401, неверный токен → 401', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    for (const extra of [
      {},
      { cookie: adminCookie, origin: ORIGIN },
      { authorization: 'Bearer plnr_x' },
    ]) {
      const r = await fetch(base, { method: 'POST', headers: { ...headers, ...extra }, body });
      expect(r.status).toBe(401);
      expect((await r.json()).code).toBe('unauthenticated');
    }
  });

  it('сессия + Bearer x (неизвестный токен) + верный Origin → 401', async () => {
    const r = await fetch(base, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        cookie: adminCookie,
        origin: ORIGIN,
        authorization: 'Bearer x',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(r.status).toBe(401);
  });

  it('GET и DELETE → 405', async () => {
    for (const method of ['GET', 'DELETE'])
      expect(
        (await fetch(base, { method, headers: { authorization: `Bearer ${write.secret}` } }))
          .status,
      ).toBe(405);
  });

  it('list_spaces / list_projects: только свои', async () => {
    const c = await connect(write.secret);
    const [, sp] = await call(c, 'list_spaces');
    expect(sp.map((s: { id: string }) => s.id)).toEqual([w.spaceId]);
    const [, pr] = await call(c, 'list_projects', { spaceId: w.spaceId });
    expect(pr.map((p: { id: string }) => p.id)).toEqual([w.projectId]);
    const o = await connect(outsider.secret);
    expect((await call(o, 'list_spaces'))[1]).toEqual([]);
    expect((await call(o, 'list_projects'))[1]).toEqual([]);
    const [err, e] = await call(o, 'list_projects', { spaceId: w.spaceId });
    expect(err).toBe(true);
    expect(e.code).toBe('not_found');
  });

  it('create_task → get_task по key; description — текст', async () => {
    const c = await connect(write.secret);
    const t = await mk(c, 'Починить вход', { description: 'строка 1\nстрока 2' });
    expect(t.key).toMatch(/^[A-Z0-9_-]+-\d+$/i);
    expect(t.description).toBe('строка 1\nстрока 2');
    const [err, g] = await call(c, 'get_task', { task: t.key });
    expect(err).toBe(false);
    expect(g).toMatchObject({ id: t.id, title: 'Починить вход', comments: [] });
  });

  it('update_task: статус и исполнители', async () => {
    const c = await connect(write.secret);
    const t = await mk(c, 'Upd');
    const st = w.statusIds[2]!;
    const [err, u] = await call(c, 'update_task', {
      task: t.key,
      statusId: st,
      assigneeIds: [w.member.userId],
    });
    expect(err, JSON.stringify(u)).toBe(false);
    expect(u).toMatchObject({ statusId: st, assigneeIds: [w.member.userId] });
  });

  it('add_comment с @login → упоминание; get_task отдаёт комментарии', async () => {
    const c = await connect(write.secret);
    const t = await mk(c, 'Comm');
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, w.admin.userId));
    const [err, cm] = await call(c, 'add_comment', { task: t.id, text: `привет @${u!.login}` });
    expect(err, JSON.stringify(cm)).toBe(false);
    expect(cm.body).toBe(`привет @${u!.login}`);
    const [, g] = await call(c, 'get_task', { task: t.id });
    expect(g.comments).toHaveLength(1);
    expect(g.comments[0].body).toBe(`привет @${u!.login}`);
  });

  it('search_tasks: по части заголовка (без регистра) и по key', async () => {
    const c = await connect(write.secret);
    const t = await mk(c, 'УникальныйЗаголовокXyz');
    const [, a] = await call(c, 'search_tasks', { query: 'уникальныйзаголовокxyz' });
    expect(a.map((x: { id: string }) => x.id)).toEqual([t.id]);
    const [, b] = await call(c, 'search_tasks', { query: t.key.toLowerCase() });
    expect(b.map((x: { id: string }) => x.id)).toContain(t.id);
    expect((await call(c, 'search_tasks', { query: '100%_нет' }))[1]).toEqual([]);
  });

  it('my_tasks: назначенные мне; done скрыт без includeDone', async () => {
    const c = await connect(write.secret);
    const open = await mk(c, 'Мой открытый', { assigneeIds: [w.member.userId] });
    const done = await mk(c, 'Мой закрытый', { assigneeIds: [w.member.userId] });
    await mk(c, 'Чужой');
    // statusIds[3] — done по умолчанию в space.create
    const [, d] = await call(c, 'update_task', { task: done.id, statusId: w.statusIds[3] });
    expect(d.completedAt).not.toBeNull();
    const ids = (await call(c, 'my_tasks'))[1].map((x: { id: string }) => x.id);
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(done.id);
    const all = (await call(c, 'my_tasks', { includeDone: true }))[1].map(
      (x: { id: string }) => x.id,
    );
    expect(all).toContain(done.id);
  });

  it('read-токен: чтение ok, запись → isError forbidden', async () => {
    const c = await connect(read.secret);
    expect((await call(c, 'list_spaces'))[0]).toBe(false);
    for (const [name, args] of [
      ['create_task', { projectId: w.projectId, title: 'x' }],
      ['update_task', { task: 'A-1', title: 'x' }],
      ['add_comment', { task: 'A-1', text: 'x' }],
    ] as const) {
      const [err, e] = await call(c, name, args);
      expect(err, name).toBe(true);
      expect(e.code).toBe('forbidden');
    }
  });

  it('чужая задача → isError not_found; неверные аргументы → ошибка', async () => {
    const t = await mk(await connect(write.secret), 'Приватная');
    const o = await connect(outsider.secret);
    const [err, e] = await call(o, 'get_task', { task: t.key });
    expect(err).toBe(true);
    expect(e.code).toBe('not_found');
    expect((await call(o, 'update_task', { task: t.id, title: 'взлом' }))[1].code).toBe(
      'not_found',
    );
    const bad = (await o.callTool({
      name: 'create_task',
      arguments: { title: 'без проекта' },
    })) as {
      isError?: boolean;
    };
    expect(bad.isError).toBe(true);
  });

  it('запись через MCP помечает activity.viaTokenId', async () => {
    const t = await mk(await connect(write.secret), 'Via');
    const rows = await db.select().from(schema.activity).where(eq(schema.activity.taskId, t.id));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.viaTokenId === write.id)).toBe(true);
  });

  it('REST POST по Bearer → activity.viaTokenId = id токена', async () => {
    const r = await fetch(`${await app.getUrl()}/api/v1/tasks`, {
      method: 'POST',
      headers: { authorization: `Bearer ${write.secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: w.projectId, title: 'REST' }),
    });
    expect(r.status).toBe(201);
    const id = (await r.json()).data.id;
    const rows = await db.select().from(schema.activity).where(eq(schema.activity.taskId, id));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((x) => x.viaTokenId === write.id)).toBe(true);
  });
});

describe('MCP: пользовательские поля', () => {
  const mkField = async () => {
    const id = uuidv7();
    await w.admin.ok('field.create', {
      id,
      projectId: w.projectId,
      name: 'F',
      type: 'number',
      rank: 'a0',
    });
    return id;
  };

  it('fields: list_fields отдаёт определения проекта; чужому — not_found', async () => {
    const id = await mkField();
    const [err, defs] = await call(await connect(write.secret), 'list_fields', {
      projectId: w.projectId,
    });
    expect(err).toBe(false);
    expect(defs.map((f: { id: string }) => f.id)).toContain(id);
    const [e2, e] = await call(await connect(outsider.secret), 'list_fields', {
      projectId: w.projectId,
    });
    expect([e2, e.code]).toEqual([true, 'not_found']);
  });

  it('fields: update_task ставит и убирает значение, неверное → invalid_request', async () => {
    const id = await mkField();
    const c = await connect(write.secret);
    const t = await mk(c, 'Поля');
    const [e1, u] = await call(c, 'update_task', { task: t.key, fields: { [id]: 3 } });
    expect(e1, JSON.stringify(u)).toBe(false);
    expect(u.fields).toEqual({ [id]: 3 });
    const [e2, bad] = await call(c, 'update_task', { task: t.key, fields: { [id]: 'x' } });
    expect([e2, bad.code]).toEqual([true, 'invalid_request']);
    const [, cleared] = await call(c, 'update_task', { task: t.key, fields: { [id]: null } });
    expect(cleared.fields).toEqual({});
  });

  it('fields: read-токен на update_task с fields → forbidden', async () => {
    const id = await mkField();
    const [err, e] = await call(await connect(read.secret), 'update_task', {
      task: 'A-1',
      fields: { [id]: 1 },
    });
    expect([err, e.code]).toEqual([true, 'forbidden']);
  });
});
