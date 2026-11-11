import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
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

/** SDK client (Client + StreamableHTTPClientTransport) in a child process, see bridge.mjs */
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
/** tool call → [isError, parsed JSON] */
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
  it('initialize и tools/list: 20 инструментов со схемами', async () => {
    const c = await connect(write.secret);
    const { tools } = await c.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'add_comment',
        'create_doc',
        'create_task',
        'current_sprint',
        'get_doc',
        'get_task',
        'link_doc_task',
        'list_docs',
        'list_fields',
        'list_projects',
        'list_spaces',
        'link_tasks',
        'log_time',
        'my_tasks',
        'project_dictionary',
        'search_tasks',
        'start_timer',
        'stop_timer',
        'update_doc',
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
    // statusIds[3] — done by default in space.create
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

  it('project_dictionary: статусы, метки, участники; чужому — not_found', async () => {
    const c = await connect(write.secret);
    const [err, d] = await call(c, 'project_dictionary', { projectId: w.projectId });
    expect(err, JSON.stringify(d)).toBe(false);
    expect(d.statuses.map((x: { id: string }) => x.id).sort()).toEqual([...w.statusIds].sort());
    expect(d.statuses[0]).toEqual({
      id: expect.any(String),
      name: expect.any(String),
      category: expect.any(String),
    });
    expect(d.labels).toEqual([]);
    expect(d.members.map((m: { id: string }) => m.id)).toContain(w.member.userId);
    expect(d.members.map((m: { id: string }) => m.id)).not.toContain(w.outsider.userId);
    const o = await connect(outsider.secret);
    expect((await call(o, 'project_dictionary', { projectId: w.projectId }))[1].code).toBe(
      'not_found',
    );
  });

  it('задачи несут название и категорию статуса; search_tasks по statusCategory', async () => {
    const c = await connect(write.secret);
    const t = await mk(c, 'КатегорияXyz');
    const [, g] = await call(c, 'get_task', { task: t.key });
    expect(g.status).toEqual({ name: expect.any(String), category: expect.any(String) });
    const cat = g.status.category as string;
    const [, a] = await call(c, 'search_tasks', { query: 'КатегорияXyz', statusCategory: cat });
    expect(a.map((x: { id: string }) => x.id)).toEqual([t.id]);
    expect(a[0].status).toEqual(g.status);
    const other = cat === 'done' ? 'todo' : 'done';
    const [, b] = await call(c, 'search_tasks', { query: 'КатегорияXyz', statusCategory: other });
    expect(b).toEqual([]);
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

describe('MCP: связи, время, спринт', () => {
  beforeAll(async () => {
    await db
      .insert(schema.settings)
      .values({ id: 'enabled_modules', value: ['time', 'sprints'] })
      .onConflictDoUpdate({ target: schema.settings.id, set: { value: ['time', 'sprints'] } });
  });

  it('wk5: link_tasks создаёт связь, повтор → conflict; read-токен → forbidden', async () => {
    const c = await connect(write.secret);
    const a = await mk(c, 'L1');
    const b = await mk(c, 'L2');
    const [e1, l] = await call(c, 'link_tasks', { task: a.key, target: b.key, kind: 'blocks' });
    expect(e1, JSON.stringify(l)).toBe(false);
    expect(l).toMatchObject({ taskId: a.id, targetId: b.id, kind: 'blocks' });
    const [e2, d] = await call(c, 'link_tasks', { task: b.id, target: a.id, kind: 'relates' });
    expect([e2, d.code]).toEqual([true, 'conflict']);
    const r = await connect(read.secret);
    expect(await call(r, 'link_tasks', { task: a.id, target: b.id, kind: 'relates' })).toEqual([
      true,
      { code: 'forbidden', message: expect.any(String) },
    ]);
    await Promise.all([c.close(), r.close()]);
  });

  it('wk5: log_time — минуты, дата, начало 09:00 UTC; чужая задача → not_found', async () => {
    const c = await connect(write.secret);
    const t = await mk(c, 'LT');
    const [e, en] = await call(c, 'log_time', { task: t.key, minutes: 90, date: '2026-09-01' });
    expect(e, JSON.stringify(en)).toBe(false);
    expect(en).toMatchObject({
      startedAt: '2026-09-01T09:00:00.000Z',
      durationSec: 5400,
      source: 'manual',
    });
    const [, today] = await call(c, 'log_time', { task: t.id, minutes: 1 });
    expect(today.startedAt).toBe(`${new Date().toISOString().slice(0, 10)}T09:00:00.000Z`);
    const o = await connect(outsider.secret);
    const [e2, d] = await call(o, 'log_time', { task: t.id, minutes: 5 });
    expect([e2, d.code]).toEqual([true, 'not_found']);
    await Promise.all([c.close(), o.close()]);
  });

  it('wk5: start_timer / stop_timer', async () => {
    const c = await connect(write.secret);
    const t = await mk(c, 'TM');
    const [, none] = await call(c, 'stop_timer');
    expect(none).toBeNull();
    const [e, s] = await call(c, 'start_timer', { task: t.key });
    expect(e, JSON.stringify(s)).toBe(false);
    expect(s).toMatchObject({ taskId: t.id, endedAt: null });
    const [, st] = await call(c, 'stop_timer');
    expect(st).toMatchObject({ id: s.id });
    expect(st.endedAt).not.toBeNull();
    const r = await connect(read.secret);
    expect((await call(r, 'start_timer', { task: t.id }))[1].code).toBe('forbidden');
    await Promise.all([c.close(), r.close()]);
  });

  it('wk5: current_sprint — null без цикла; с циклом — цикл и его задачи', async () => {
    const c = await connect(write.secret);
    expect(await call(c, 'current_sprint', { projectId: w.projectId })).toEqual([false, null]);
    const t = await mk(c, 'SP');
    const id = uuidv7();
    const day = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);
    await w.member.ok('sprints.create', {
      id,
      projectId: w.projectId,
      startDate: day(-1),
      endDate: day(5),
    });
    await w.member.ok('sprints.setTask', { taskId: t.id, cycleId: id });
    const [e, d] = await call(c, 'current_sprint', { projectId: w.projectId });
    expect(e, JSON.stringify(d)).toBe(false);
    expect(d.cycle.id).toBe(id);
    expect(d.tasks.map((x: { key: string }) => x.key)).toEqual([t.key]);
    const o = await connect(outsider.secret);
    expect((await call(o, 'current_sprint', { projectId: w.projectId }))[1].code).toBe('not_found');
    await Promise.all([c.close(), o.close()]);
  });
});

describe('MCP/REST: документы (PLNRAPP-180)', () => {
  type Doc = { id: string; title: string; markdown: string; tasks: { key: string }[] };

  it('create_doc из markdown → get_doc и list_docs; дочерний документ по parentId', async () => {
    const c = await connect(write.secret);
    const [e, d] = await call(c, 'create_doc', {
      projectId: w.projectId,
      title: 'План',
      markdown: '# Этапы\n\n- [x] один\n- [ ] два',
    });
    expect(e, JSON.stringify(d)).toBe(false);
    expect(d).toMatchObject({ title: 'План', projectId: w.projectId, tasks: [] });
    expect(d.markdown).toContain('# Этапы');
    expect(d.markdown).toContain('- [x] один');
    expect(d).not.toHaveProperty('body');
    const { rows } = await db.execute<{ body: { content: { type: string }[] } }>(
      sql`select body from docs_pages where id = ${d.id}`,
    );
    expect(rows[0]!.body.content.map((n) => n.type)).toEqual(['heading', 'taskList']);
    const [, kid] = await call(c, 'create_doc', {
      projectId: w.projectId,
      parentId: d.id,
      title: 'Подплан',
    });
    expect(kid.parentId).toBe(d.id);
    const [, all] = await call(c, 'list_docs', { projectId: w.projectId });
    expect(all.map((x: Doc) => x.id)).toEqual(expect.arrayContaining([d.id, kid.id]));
    expect(all[0]).not.toHaveProperty('markdown');
    const [, kids] = await call(c, 'list_docs', { projectId: w.projectId, parentId: d.id });
    expect(kids.map((x: Doc) => x.id)).toEqual([kid.id]);
    expect((await call(c, 'get_doc', { id: kid.id }))[1].markdown).toBe('');
    await c.close();
  });

  it('update_doc: append дописывает, markdown заменяет, оба сразу → invalid_request', async () => {
    const c = await connect(write.secret);
    const [, d] = await call(c, 'create_doc', {
      projectId: w.projectId,
      title: 'Статус',
      markdown: 'начало',
    });
    const [e1, a] = await call(c, 'update_doc', { id: d.id, append: '## Итог\n\nготово' });
    expect(e1, JSON.stringify(a)).toBe(false);
    expect(a.markdown).toMatch(/начало[\s\S]*## Итог[\s\S]*готово/);
    const [, r] = await call(c, 'update_doc', { id: d.id, title: 'Статус 2', markdown: 'заново' });
    expect([r.title, r.markdown.trim()]).toEqual(['Статус 2', 'заново']);
    const [e3, x] = await call(c, 'update_doc', { id: d.id, markdown: 'a', append: 'b' });
    expect([e3, x.code]).toEqual([true, 'invalid_request']);
    await c.close();
  });

  it('update_doc replace: фрагмент ровно один раз; get_doc section — один раздел', async () => {
    const c = await connect(write.secret);
    const [, d] = await call(c, 'create_doc', {
      projectId: w.projectId,
      title: 'План',
      markdown:
        '# План\n\nвступление\n\n## Этап 1\n\nстатус: да\n\n### Детали\n\nx\n\n## Этап 2\n\nстатус: нет\n\n```\n## не заголовок\n```',
    });
    const [e1, r] = await call(c, 'update_doc', {
      id: d.id,
      replace: { find: 'статус: нет', replace: 'статус: да $&' },
    });
    expect(e1, JSON.stringify(r)).toBe(false);
    expect(r.markdown).toContain('статус: да $&');
    const [e2, x] = await call(c, 'update_doc', {
      id: d.id,
      replace: { find: 'статус: да', replace: '-' },
    });
    expect([e2, x.code, x.message]).toEqual([
      true,
      'invalid_request',
      expect.stringContaining('2 раз'),
    ]);
    const [e3, y] = await call(c, 'update_doc', {
      id: d.id,
      replace: { find: 'нет такого', replace: '' },
    });
    expect([e3, y.code]).toEqual([true, 'invalid_request']);
    const [, s] = await call(c, 'get_doc', { id: d.id, section: 'Этап 1' });
    expect(s.markdown).toBe('## Этап 1\n\nстатус: да\n\n### Детали\n\nx');
    const [, s2] = await call(c, 'get_doc', { id: d.id, section: 'Этап 2' });
    expect(s2.markdown).toMatch(/^## Этап 2[\s\S]*## не заголовок\n```$/);
    const [e4, z4] = await call(c, 'get_doc', { id: d.id, section: 'Этап 3' });
    expect([e4, z4.code, z4.message]).toEqual([
      true,
      'not_found',
      expect.stringContaining('Этап 2'),
    ]);
    await c.close();
  });

  it('link_doc_task по ключу задачи; повтор не дублирует', async () => {
    const c = await connect(write.secret);
    const t = await mk(c, 'Связанная');
    const [, d] = await call(c, 'create_doc', { projectId: w.projectId, title: 'С задачей' });
    const [e, l] = await call(c, 'link_doc_task', { pageId: d.id, task: t.key });
    expect(e, JSON.stringify(l)).toBe(false);
    expect(l.tasks).toEqual([{ id: t.id, key: t.key, title: 'Связанная' }]);
    expect((await call(c, 'link_doc_task', { pageId: d.id, task: t.id }))[1].tasks).toHaveLength(1);
    await c.close();
  });

  it('права: read-токен пишет → forbidden, чужой → not_found, модуль выключен → module_disabled', async () => {
    const c = await connect(write.secret);
    const [, d] = await call(c, 'create_doc', { projectId: w.projectId, title: 'Свой' });
    const r = await connect(read.secret);
    expect((await call(r, 'get_doc', { id: d.id }))[0]).toBe(false);
    expect((await call(r, 'create_doc', { projectId: w.projectId, title: 'x' }))[1].code).toBe(
      'forbidden',
    );
    expect((await call(r, 'update_doc', { id: d.id, append: 'x' }))[1].code).toBe('forbidden');
    const o = await connect(outsider.secret);
    expect((await call(o, 'get_doc', { id: d.id }))[1].code).toBe('not_found');
    expect((await call(o, 'list_docs', { projectId: w.projectId }))[1].code).toBe('not_found');
    expect((await call(o, 'update_doc', { id: d.id, append: 'взлом' }))[1].code).toBe('not_found');
    await w.admin.ok('project.setModule', {
      projectId: w.projectId,
      moduleId: 'docs',
      enabled: false,
    });
    try {
      expect((await call(c, 'get_doc', { id: d.id }))[1].code).toBe('module_disabled');
      expect((await call(c, 'list_docs', { projectId: w.projectId }))[1].code).toBe(
        'module_disabled',
      );
    } finally {
      await w.admin.ok('project.setModule', {
        projectId: w.projectId,
        moduleId: 'docs',
        enabled: true,
      });
    }
    await Promise.all([c.close(), r.close(), o.close()]);
  });

  it('REST: POST /docs → 201, PATCH append, POST /docs/:id/tasks, GET /docs?projectId', async () => {
    const url = `${await app.getUrl()}/api/v1`;
    const req = (method: string, path: string, body?: object) =>
      fetch(`${url}${path}`, {
        method,
        headers: { authorization: `Bearer ${write.secret}`, 'content-type': 'application/json' },
        body: body && JSON.stringify(body),
      });
    const cr = await req('POST', '/docs', { projectId: w.projectId, title: 'REST', markdown: 'a' });
    expect(cr.status).toBe(201);
    const d = (await cr.json()).data as Doc;
    const up = await req('PATCH', `/docs/${d.id}`, { append: '**b**' });
    expect((await up.json()).data.markdown).toMatch(/a[\s\S]*\*\*b\*\*/);
    const t = await mk(await connect(write.secret), 'REST-задача');
    const ln = await req('POST', `/docs/${d.id}/tasks`, { task: t.key });
    expect(ln.status).toBe(201);
    expect((await ln.json()).data.tasks[0].key).toBe(t.key);
    const ls = await req('GET', `/docs?projectId=${w.projectId}`);
    expect(((await ls.json()).data as Doc[]).some((x) => x.id === d.id)).toBe(true);
    expect((await req('GET', '/docs')).status).toBe(400);
    expect((await req('GET', `/docs/${uuidv7()}`)).status).toBe(404);
  });
});
