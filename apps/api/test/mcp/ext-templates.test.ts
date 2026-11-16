import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiTokenCreatedSchema } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { toolDefs } from '../../src/mcp/tools.js';
import { area } from '../../src/rest/ext/templates.js';
import { RestService } from '../../src/rest/rest.service.js';
import * as schema from '../../src/db/schema.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, world, type World } from '../sync/helpers.js';
import { eq, sql } from 'drizzle-orm';

// PLNRAPP-276 (TE-1): templates and task / project from a template over REST v1 and MCP, as the user
const PARITY_TEMPLATES: Record<string, string> = {
  'GET /api/v1/spaces/{id}/templates': 'list_templates',
  'GET /api/v1/templates/{id}': 'get_template',
  'POST /api/v1/spaces/{id}/templates': 'create_template',
  'PATCH /api/v1/templates/{id}': 'update_template',
  'DELETE /api/v1/templates/{id}': 'delete_template',
  'POST /api/v1/templates/{id}/task': 'create_task_from_template',
  'POST /api/v1/templates/{id}/project': 'create_project_from_template',
};

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
let w: World;
let admin: string;
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

const setModules = (v: string[]) =>
  db
    .insert(schema.settings)
    .values({ id: 'enabled_modules', value: v })
    .onConflictDoUpdate({ target: schema.settings.id, set: { value: v } });

beforeAll(async () => {
  await setModules(['templates']);
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  w = await world(db);
  admin = await issue(w.admin.userId, 'write');
  read = await issue(w.admin.userId, 'read');
  outsider = await issue(w.outsider.userId, 'write');
});
afterAll(async () => {
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

const node = (over: object = {}) => ({
  title: 'Шаг',
  description: null,
  priority: 2,
  dueInDays: 3,
  startInDays: null,
  fields: [],
  labels: [],
  assigneeIds: [],
  checklist: ['а', 'б'],
  subtasks: [
    {
      ...{ title: 'Под', description: null, priority: 0 },
      dueInDays: null,
      startInDays: null,
      fields: [],
      labels: [],
      assigneeIds: [],
      checklist: [],
    },
  ],
  ...over,
});
const projData = {
  project: { description: null, color: null, icon: null },
  statuses: [{ name: 'Новые', category: 'todo', color: '#111' }],
  labels: [{ name: 'Bug', color: '#f00' }],
  fields: [],
  tasks: [{ ...node(), status: 'Новые' }],
};

describe('шаблоны (ext/templates)', () => {
  it('PARITY_TEMPLATES равен операциям области; удаление — danger delete, чтение — без write', () => {
    expect(
      Object.fromEntries(area.ops.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o.tool])),
    ).toEqual(PARITY_TEMPLATES);
    const defs = toolDefs(app.get(RestService));
    expect(defs.find((d) => d.name === 'delete_template')?.danger).toBe('delete');
    for (const t of ['list_templates', 'get_template'])
      expect(defs.find((d) => d.name === t)?.write, t).toBe(false);
  });

  it('шаблон задачи: создать → список → изменить → задача из шаблона → удалить', async () => {
    const call = await mcp(admin);
    const [e0, tpl] = await call('create_template', {
      id: w.spaceId,
      kind: 'task',
      name: 'Релиз',
      data: node(),
    });
    expect([e0, tpl.createdBy], JSON.stringify(tpl)).toEqual([false, w.admin.userId]);
    const [, bad] = await call('create_template', {
      id: w.spaceId,
      kind: 'task',
      name: 'X',
      data: { nope: 1 },
    });
    expect(bad.code).toBe('invalid_request');
    expect((await call('update_template', { id: tpl.id, name: 'Релиз 2' }))[1].name).toBe(
      'Релиз 2',
    );
    const [, list] = await call('list_templates', { id: w.spaceId, kind: 'task' });
    expect(list.map((x: { id: string }) => x.id)).toContain(tpl.id);
    expect((await call('list_templates', { id: w.spaceId, kind: 'project' }))[1]).toEqual([]);
    expect((await call('get_template', { id: tpl.id }))[1].name).toBe('Релиз 2');

    const [e1, made] = await call('create_task_from_template', {
      id: tpl.id,
      projectId: w.projectId,
    });
    expect(e1, JSON.stringify(made)).toBe(false);
    const [t] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, made.id));
    expect(t).toMatchObject({ title: 'Шаг', priority: 2, createdBy: w.admin.userId });
    const kids = await db.select().from(schema.tasks).where(eq(schema.tasks.parentId, made.id));
    expect(kids.map((k) => k.title)).toEqual(['Под']);
    // as a subtask of an existing one, by REST
    const [s, sub] = await rest(admin, 'POST', `/templates/${tpl.id}/task`, {
      projectId: w.projectId,
      parent: made.id,
    });
    expect([s, !!sub.data?.id ?? sub], JSON.stringify(sub)).toEqual([201, true]);
    const [e2, wrong] = await call('create_project_from_template', {
      id: tpl.id,
      name: 'P',
      key: 'TPA',
    });
    expect([e2, wrong.code]).toEqual([true, 'invalid_request']);

    expect((await call('delete_template', { id: tpl.id }))[0]).toBe(false);
    expect((await rest(admin, 'DELETE', `/templates/${tpl.id}`))[1].code).toBe('not_found');
  });

  it('шаблон проекта: проект из шаблона со статусами, метками и задачами', async () => {
    const call = await mcp(admin);
    const [, tpl] = await call('create_template', {
      id: w.spaceId,
      kind: 'project',
      name: 'Типовой',
      data: projData,
    });
    const [e, p] = await call('create_project_from_template', {
      id: tpl.id,
      name: 'Из шаблона',
      key: 'FRTP',
    });
    expect([e, p.key], JSON.stringify(p)).toEqual([false, 'FRTP']);
    const sts = await db.select().from(schema.statuses).where(eq(schema.statuses.projectId, p.id));
    expect(sts.map((s) => s.name)).toEqual(['Новые']);
    const ts = await db.select().from(schema.tasks).where(eq(schema.tasks.projectId, p.id));
    expect(ts.map((x) => x.title).sort()).toEqual(['Под', 'Шаг']);
    const [e2, dup] = await call('create_project_from_template', {
      id: tpl.id,
      name: 'Ещё',
      key: 'FRTP',
    });
    expect([e2, dup.code]).toEqual([true, 'conflict']);
  });

  it('отказы: чужой — not_found, токен read — forbidden, модуль выключен — module_disabled', async () => {
    const adm = await mcp(admin);
    const [, tpl] = await adm('create_template', {
      id: w.spaceId,
      kind: 'task',
      name: 'Т',
      data: node(),
    });
    const out = await mcp(outsider);
    for (const [tool, args] of [
      ['list_templates', { id: w.spaceId }],
      ['get_template', { id: tpl.id }],
      ['create_template', { id: w.spaceId, kind: 'task', name: 'x', data: node() }],
      ['update_template', { id: tpl.id, name: 'x' }],
      ['delete_template', { id: tpl.id }],
      ['create_task_from_template', { id: tpl.id, projectId: w.projectId }],
      ['create_project_from_template', { id: tpl.id, name: 'x', key: 'XX' }],
    ] as const) {
      const [e, r] = await out(tool, args);
      expect([tool, e, r.code]).toEqual([tool, true, 'not_found']);
    }
    const ro = await mcp(read);
    for (const o of area.ops.filter((x) => x.write)) {
      const [e, r] = await ro(o.tool, {
        id: tpl.id,
        projectId: w.projectId,
        kind: 'task',
        name: 'x',
        data: {},
        key: 'XX',
      });
      expect([o.tool, e, r.code]).toEqual([o.tool, true, 'forbidden']);
    }
    expect((await ro('get_template', { id: tpl.id }))[0]).toBe(false);

    // data module: off in the project — module_disabled
    await db.execute(sql`update projects set modules = '{}' where id = ${w.projectId}`);
    try {
      const [e, r] = await adm('create_task_from_template', { id: tpl.id, projectId: w.projectId });
      expect([e, r.code]).toEqual([true, 'module_disabled']);
    } finally {
      await db.execute(sql`update projects set modules = '{templates}' where id = ${w.projectId}`);
    }
  });
});
