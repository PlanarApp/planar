import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiTokenCreatedSchema } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { toolDefs } from '../../src/mcp/tools.js';
import { area } from '../../src/rest/ext/forms.js';
import { RestService } from '../../src/rest/rest.service.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, world, type World } from '../sync/helpers.js';
import { sql } from 'drizzle-orm';
import { uuidv7 } from '@planar/shared';

// PLNRAPP-276 (FO-1): forms, dashboards and widgets over REST v1 and MCP, as the user
const PARITY_FORMS: Record<string, string> = {
  'GET /api/v1/projects/{id}/forms': 'list_forms',
  'GET /api/v1/forms/{id}': 'get_form',
  'POST /api/v1/projects/{id}/forms': 'create_form',
  'PATCH /api/v1/forms/{id}': 'update_form',
  'DELETE /api/v1/forms/{id}': 'delete_form',
  'GET /api/v1/forms/{id}/link': 'get_form_link',
  'GET /api/v1/spaces/{id}/dashboards': 'list_dashboards',
  'GET /api/v1/dashboards/{id}': 'get_dashboard',
  'POST /api/v1/spaces/{id}/dashboards': 'create_dashboard',
  'PATCH /api/v1/dashboards/{id}': 'update_dashboard',
  'DELETE /api/v1/dashboards/{id}': 'delete_dashboard',
  'POST /api/v1/dashboards/{id}/widgets': 'create_widget',
  'PATCH /api/v1/widgets/{id}': 'update_widget',
  'DELETE /api/v1/widgets/{id}': 'delete_widget',
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
  admin = await issue(w.admin.userId, 'write');
  member = await issue(w.member.userId, 'write');
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

const numberCfg = { filter: { op: 'and', rules: [] } };

describe('формы, дашборды и виджеты (ext/forms)', () => {
  it('PARITY_FORMS равен операциям области; удаления — danger delete, чтение — без write', () => {
    expect(
      Object.fromEntries(area.ops.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o.tool])),
    ).toEqual(PARITY_FORMS);
    const defs = toolDefs(app.get(RestService));
    for (const o of area.ops.filter((x) => x.method === 'delete'))
      expect(defs.find((d) => d.name === o.tool)?.danger, o.tool).toBe('delete');
    for (const t of ['list_forms', 'get_form', 'get_form_link', 'list_dashboards', 'get_dashboard'])
      expect(defs.find((d) => d.name === t)?.write, t).toBe(false);
  });

  it('формы: создать → изменить → ссылка без секретов → список → удалить', async () => {
    const call = await mcp(admin);
    const [e0, f] = await call('create_form', { id: w.projectId, title: 'Заявка' });
    expect(e0, JSON.stringify(f)).toBe(false);
    expect([f.statusId, f.enabled, f.fields.length]).toEqual([w.statusIds[0], true, 1]);
    const [e1, bad] = await call('update_form', {
      id: f.id,
      fields: [{ key: 'email', label: 'Почта', required: true }],
    });
    expect([e1, bad.code]).toEqual([true, 'invalid_request']);
    const [e2, u] = await call('update_form', {
      id: f.id,
      description: 'Опиши',
      fields: [
        { key: 'title', label: 'Тема', required: true },
        { key: 'email', label: 'Почта', required: false },
      ],
    });
    expect([e2, u.description, u.fields.length], JSON.stringify(u)).toEqual([false, 'Опиши', 2]);
    const [e3, link] = await call('get_form_link', { id: f.id });
    expect(e3).toBe(false);
    expect(link.path).toBe(`/f/${f.slug}`);
    expect(Object.keys(link).sort()).toEqual(['enabled', 'path', 'url']);
    expect((await call('get_form', { id: f.id }))[1].slug).toBe(f.slug);
    const [, list] = await rest(admin, 'GET', `/projects/${w.projectId}/forms`);
    expect(list.data.map((x: { id: string }) => x.id)).toContain(f.id);
    expect((await call('update_form', { id: f.id, enabled: false }))[1].enabled).toBe(false);
    expect((await rest(admin, 'DELETE', `/forms/${f.id}`))[0]).toBe(204);
    expect((await call('delete_form', { id: f.id }))[1].code).toBe('not_found');
  });

  it('дашборды и виджеты: создать → виджет → изменить → личный чужому не виден → удалить', async () => {
    const call = await mcp(member);
    const [e0, b] = await call('create_dashboard', { id: w.spaceId, name: 'Общий' });
    expect(e0, JSON.stringify(b)).toBe(false);
    const [e1, p] = await call('create_dashboard', {
      id: w.spaceId,
      name: 'Личный',
      personal: true,
    });
    expect([e1, p.userId], JSON.stringify(p)).toEqual([false, w.member.userId]);
    const [e2, wd] = await call('create_widget', {
      id: b.id,
      kind: 'number',
      config: numberCfg,
      x: 0,
      y: 0,
      w: 4,
      h: 2,
      title: 'Всего',
    });
    expect(e2, JSON.stringify(wd)).toBe(false);
    const [e3, bad] = await call('create_widget', {
      id: b.id,
      kind: 'number',
      config: numberCfg,
      x: 10,
      y: 0,
      w: 4,
      h: 2,
    });
    expect([e3, bad.code]).toEqual([true, 'invalid_request']);
    const [e4, up] = await call('update_widget', { id: wd.id, w: 6, title: null });
    expect([e4, up.w, up.title], JSON.stringify(up)).toEqual([false, 6, null]);
    const [, one] = await call('get_dashboard', { id: b.id });
    expect(one.widgets.map((x: { id: string }) => x.id)).toEqual([wd.id]);
    expect((await call('update_dashboard', { id: b.id, name: 'Новый' }))[1].name).toBe('Новый');

    // the personal dashboard is invisible to another member of the space
    const adm = await mcp(admin);
    const [, seen] = await adm('list_dashboards', { id: w.spaceId });
    const ids = seen.map((x: { id: string }) => x.id);
    expect([ids.includes(b.id), ids.includes(p.id)]).toEqual([true, false]);
    expect((await adm('get_dashboard', { id: p.id }))[1].code).toBe('not_found');

    expect((await call('delete_widget', { id: wd.id }))[0]).toBe(false);
    expect((await rest(member, 'DELETE', `/dashboards/${b.id}`))[0]).toBe(204);
    expect((await call('delete_dashboard', { id: p.id }))[0]).toBe(false);
    expect((await call('delete_dashboard', { id: b.id }))[1].code).toBe('not_found');
  });

  it('отказы: чужой — not_found, токен read — forbidden, модуль forms выключен — module_disabled', async () => {
    const adm = await mcp(admin);
    const [, f] = await adm('create_form', { id: w.projectId, title: 'Ф' });
    const [, b] = await adm('create_dashboard', { id: w.spaceId, name: 'Д' });
    const [, wd] = await adm('create_widget', {
      id: b.id,
      kind: 'number',
      config: numberCfg,
      x: 0,
      y: 0,
      w: 2,
      h: 2,
    });
    const out = await mcp(outsider);
    for (const [tool, args] of [
      ['list_forms', { id: w.projectId }],
      ['get_form', { id: f.id }],
      ['create_form', { id: w.projectId, title: 'x' }],
      ['update_form', { id: f.id, title: 'x' }],
      ['delete_form', { id: f.id }],
      ['get_form_link', { id: f.id }],
      ['list_dashboards', { id: w.spaceId }],
      ['get_dashboard', { id: b.id }],
      ['create_dashboard', { id: w.spaceId, name: 'x' }],
      ['update_dashboard', { id: b.id, name: 'x' }],
      ['delete_dashboard', { id: b.id }],
      ['create_widget', { id: b.id, kind: 'number', config: numberCfg, x: 0, y: 0, w: 1, h: 1 }],
      ['update_widget', { id: wd.id, w: 3 }],
      ['delete_widget', { id: wd.id }],
    ] as const) {
      const [e, r] = await out(tool, args);
      expect([tool, e, r.code]).toEqual([tool, true, 'not_found']);
    }
    // a member is not a space admin: forms are written by the admin only
    const mem = await mcp(member);
    expect((await mem('create_form', { id: w.projectId, title: 'x' }))[1].code).toBe('forbidden');
    expect((await mem('get_form', { id: f.id }))[0]).toBe(false);

    const ro = await mcp(read);
    for (const o of area.ops.filter((x) => x.write)) {
      const [e, r] = await ro(o.tool, {
        id: f.id,
        title: 'x',
        name: 'x',
        kind: 'number',
        config: numberCfg,
        x: 0,
        y: 0,
        w: 1,
        h: 1,
      });
      expect([o.tool, e, r.code]).toEqual([o.tool, true, 'forbidden']);
    }
    expect((await ro('list_dashboards', { id: w.spaceId }))[0]).toBe(false);
    expect((await rest(read, 'POST', `/spaces/${w.spaceId}/dashboards`, { name: 'x' }))[0]).toBe(
      403,
    );

    const off = uuidv7();
    await w.admin.ok('project.create', {
      id: off,
      spaceId: w.spaceId,
      name: 'Off',
      key: 'OFFF',
      rank: 'a1',
      statusIds: Array.from({ length: 5 }, () => uuidv7()),
    });
    await db.execute(sql`update projects set modules = '{}' where id = ${off}`);
    for (const [tool, args] of [
      ['list_forms', { id: off }],
      ['create_form', { id: off, title: 'x' }],
    ] as const) {
      const [e, r] = await adm(tool, args);
      expect([tool, e, r.code]).toEqual([tool, true, 'module_disabled']);
    }
  });
});
