import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiTokenCreatedSchema, uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, world, type World } from '../sync/helpers.js';

// PLNRAPP-266: project settings over REST v1 and MCP, as the user (rights — of the mutators)
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
/** tool call through the SDK client in a child process (see bridge.mjs) → [isError, JSON] */
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

describe('настройки проекта: MCP', () => {
  it('статусы, метки, поля, проект: создать → изменить → удалить; токен read не пишет', async () => {
    const call = await mcp(admin);
    const [e0, st] = await call('create_status', {
      projectId: w.projectId,
      name: 'Ревью',
      category: 'in_progress',
    });
    expect(e0, JSON.stringify(st)).toBe(false);
    expect([st.name, st.category, typeof st.rank]).toEqual(['Ревью', 'in_progress', 'string']);
    const [, st2] = await call('update_status', { id: st.id, name: 'Проверка' });
    expect(st2.name).toBe('Проверка');
    const [e1, bad] = await call('delete_status', { id: st.id, replaceWith: st.id });
    expect([e1, bad.code]).toEqual([true, 'invalid_request']);
    expect((await call('delete_status', { id: st.id, replaceWith: w.statusIds[0] }))[0]).toBe(
      false,
    );
    expect((await call('update_status', { id: st.id, name: 'x' }))[1].code).toBe('not_found');

    const [, lb] = await call('create_label', { projectId: w.projectId, name: 'bug' });
    expect(lb.name).toBe('bug');
    expect((await call('update_label', { id: lb.id, color: '#ff0000' }))[1].color).toBe('#ff0000');
    expect((await call('delete_label', { id: lb.id }))[0]).toBe(false);

    const [, fd] = await call('create_field', {
      projectId: w.projectId,
      name: 'Оценка',
      type: 'number',
    });
    expect(fd.type).toBe('number');
    expect((await call('update_field', { id: fd.id, name: 'SP' }))[1].name).toBe('SP');
    expect(
      (await call('list_fields', { projectId: w.projectId }))[1].map((f: { id: string }) => f.id),
    ).toContain(fd.id);
    expect((await call('delete_field', { id: fd.id }))[0]).toBe(false);

    const [, pr] = await call('update_project', {
      id: w.projectId,
      description: null,
      color: '#112233',
    });
    expect(pr.color).toBe('#112233');
    const [, on] = await call('set_project_module', {
      projectId: w.projectId,
      moduleId: 'automations',
      enabled: true,
    });
    expect(on.modules).toContain('automations');
    const [eb, nm] = await call('set_project_module', {
      projectId: w.projectId,
      moduleId: 'nope',
      enabled: true,
    });
    expect([eb, nm.code]).toEqual([true, 'invalid_request']);

    const ro = await mcp(read);
    const [er, fr] = await ro('create_status', {
      projectId: w.projectId,
      name: 'x',
      category: 'todo',
    });
    expect([er, fr.code]).toEqual([true, 'forbidden']);
  });

  it('автоматизации и ИИ-действия; список ИИ-действий', async () => {
    const call = await mcp(admin);
    await call('set_project_module', {
      projectId: w.projectId,
      moduleId: 'automations',
      enabled: true,
    });
    const [ea, rule] = await call('create_automation', {
      projectId: w.projectId,
      name: 'Новая → todo',
      trigger: { type: 'task.created' },
      actions: [{ type: 'set_status', statusId: w.statusIds[1] }],
    });
    expect(ea, JSON.stringify(rule)).toBe(false);
    expect(rule.enabled).toBe(true);
    expect((await call('update_automation', { id: rule.id, enabled: false }))[1].enabled).toBe(
      false,
    );
    expect((await call('list_automations', { projectId: w.projectId }))[1]).toHaveLength(1);
    expect((await call('delete_automation', { id: rule.id }))[0]).toBe(false);

    await call('set_project_module', { projectId: w.projectId, moduleId: 'ai', enabled: true });
    const [ei, act] = await call('create_ai_action', {
      projectId: w.projectId,
      key: 'triage',
      name: 'Разбор',
    });
    expect(ei, JSON.stringify(act)).toBe(false);
    expect(act.key).toBe('triage');
    expect((await call('update_ai_action', { id: act.id, name: 'Разбор 2' }))[1].name).toBe(
      'Разбор 2',
    );
    expect(
      (await call('list_ai_actions', { projectId: w.projectId }))[1].map(
        (a: { id: string }) => a.id,
      ),
    ).toEqual([act.id]);
    expect((await call('delete_ai_action', { id: act.id }))[0]).toBe(false);
    expect((await call('list_ai_actions', { projectId: w.projectId }))[1]).toEqual([]);
  });

  it('права как у мутаторов: участник не админ; чужой — not_found', async () => {
    const call = await mcp(member);
    await mcp(admin).then((c) =>
      c('set_project_module', { projectId: w.projectId, moduleId: 'ai', enabled: true }),
    );
    const [e, r] = await call('create_ai_action', { projectId: w.projectId, key: 'x', name: 'X' });
    expect([e, r.code]).toEqual([true, 'forbidden']);
    const [e2, r2] = await call('set_project_module', {
      projectId: w.projectId,
      moduleId: 'time',
      enabled: false,
    });
    expect([e2, r2.code]).toEqual([true, 'forbidden']);
    const out = await mcp(outsider);
    const [e3, r3] = await out('create_label', { projectId: w.projectId, name: 'z' });
    expect([e3, r3.code]).toEqual([true, 'not_found']);
  });
});

describe('настройки проекта: REST v1', () => {
  it('POST 201 / PATCH 200 / DELETE 204, ошибки', async () => {
    const [s1, st] = await rest(admin, 'POST', `/projects/${w.projectId}/statuses`, {
      name: 'R',
      category: 'todo',
    });
    expect(s1, JSON.stringify(st)).toBe(201);
    const [s2, up] = await rest(admin, 'PATCH', `/statuses/${st.data.id}`, { color: '#00ff00' });
    expect([s2, up.data.color]).toEqual([200, '#00ff00']);
    expect((await rest(admin, 'DELETE', `/statuses/${st.data.id}`))[0]).toBe(400); // replaceWith is required
    expect(
      (await rest(admin, 'DELETE', `/statuses/${st.data.id}?replaceWith=${w.statusIds[0]}`))[0],
    ).toBe(204);
    expect((await rest(admin, 'PATCH', `/statuses/${uuidv7()}`, { name: 'x' }))[0]).toBe(404);

    const [s3, mod] = await rest(admin, 'PUT', `/projects/${w.projectId}/modules/automations`, {
      enabled: true,
    });
    expect(s3).toBe(200);
    expect(mod.data.modules).toContain('automations');
    expect(
      (await rest(admin, 'PATCH', `/projects/${w.projectId}`, { name: 'P2' }))[1].data.name,
    ).toBe('P2');
    expect((await rest(read, 'POST', `/projects/${w.projectId}/labels`, { name: 'x' }))[0]).toBe(
      403,
    );
    expect(
      (await rest(outsider, 'POST', `/projects/${w.projectId}/labels`, { name: 'x' }))[0],
    ).toBe(404);
    expect((await rest(admin, 'POST', `/projects/${w.projectId}/labels`, { name: 'ok' }))[0]).toBe(
      201,
    );
  });
});
