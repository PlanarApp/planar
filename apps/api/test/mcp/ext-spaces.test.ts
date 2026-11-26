import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiTokenCreatedSchema } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { toolDefs } from '../../src/mcp/tools.js';
import { area } from '../../src/rest/ext/spaces.js';
import { RestService } from '../../src/rest/rest.service.js';
import * as schema from '../../src/db/schema.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, world, type World } from '../sync/helpers.js';

// PLNRAPP-272 (MA-2): spaces, projects, members and roles over REST v1 and MCP, as the user
const PARITY_SPACES: Record<string, string> = {
  'POST /api/v1/spaces': 'create_space',
  'PATCH /api/v1/spaces/{id}': 'update_space',
  'DELETE /api/v1/spaces/{id}': 'delete_space',
  'GET /api/v1/spaces/{id}/members': 'list_space_members',
  'PUT /api/v1/spaces/{id}/members': 'set_space_members_mode',
  'POST /api/v1/spaces/{id}/members': 'add_space_member',
  'PATCH /api/v1/spaces/{id}/members/{userId}': 'update_space_member',
  'DELETE /api/v1/spaces/{id}/members/{userId}': 'remove_space_member',
  'POST /api/v1/projects': 'create_project',
  'DELETE /api/v1/projects/{id}': 'delete_project',
  'POST /api/v1/projects/{id}/move': 'move_project',
  'POST /api/v1/projects/{id}/copy-dictionaries': 'copy_project_dictionaries',
  'GET /api/v1/projects/{id}/members': 'list_project_members',
  'PUT /api/v1/projects/{id}/members': 'set_project_members_mode',
  'POST /api/v1/projects/{id}/members': 'add_project_member',
  'PATCH /api/v1/projects/{id}/members/{userId}': 'update_project_member',
  'DELETE /api/v1/projects/{id}/members/{userId}': 'remove_project_member',
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
    const text = res.content[0]!.text;
    // an SDK input validation error is plain text, not JSON
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return [!!res.isError, body] as const;
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

type Mem = { userId: string; role: string };

describe('пространства и проекты (ext/spaces)', () => {
  it('PARITY_SPACES равен операциям области; удаления — danger delete', () => {
    expect(
      Object.fromEntries(area.ops.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o.tool])),
    ).toEqual(PARITY_SPACES);
    const defs = toolDefs(app.get(RestService));
    for (const o of area.ops.filter((x) => x.method === 'delete'))
      expect(defs.find((d) => d.name === o.tool)?.danger, o.tool).toBe('delete');
    expect(defs.find((d) => d.name === 'list_space_members')?.write).toBe(false);
  });

  it('пространство: создать → изменить → участники и роли → удалить', async () => {
    const call = await mcp(admin);
    const [e0, sp] = await call('create_space', { name: 'Новое', color: '#112233' });
    expect(e0, JSON.stringify(sp)).toBe(false);
    expect([sp.name, sp.color]).toEqual(['Новое', '#112233']);
    expect((await call('update_space', { id: sp.id, description: 'о' }))[1].description).toBe('о');
    const [, ms] = await call('list_space_members', { id: sp.id });
    expect(ms.map((m: Mem) => [m.userId, m.role])).toEqual([[w.admin.userId, 'admin']]);
    const [e1, added] = await call('add_space_member', {
      id: sp.id,
      userId: w.member.userId,
      role: 'member',
    });
    expect([e1, added.role]).toEqual([false, 'member']);
    expect(
      (await call('update_space_member', { id: sp.id, userId: w.member.userId, role: 'guest' }))[1]
        .role,
    ).toBe('guest');
    const [e2, last] = await call('update_space_member', {
      id: sp.id,
      userId: w.admin.userId,
      role: 'member',
    });
    expect([e2, last.code]).toEqual([true, 'conflict']);
    expect((await call('remove_space_member', { id: sp.id, userId: w.member.userId }))[0]).toBe(
      false,
    );
    // режим состава: custom со своим списком, обратно пустой custom — ошибка
    const [em, cm] = await call('set_space_members_mode', {
      id: sp.id,
      mode: 'custom',
      members: [{ userId: w.admin.userId, role: 'admin' }],
    });
    expect([em, cm.membersMode, cm.members.length]).toEqual([false, 'custom', 1]);
    expect((await call('set_space_members_mode', { id: sp.id, mode: 'custom' }))[1].code).toBe(
      'invalid_request',
    );
    // REST: the same operation, 204
    const [s1, b1] = await rest(admin, 'POST', '/spaces', { name: 'Через REST' });
    expect(s1).toBe(201);
    expect((await rest(admin, 'DELETE', `/spaces/${b1.data.id}?withContent=true`))[0]).toBe(204);
    expect((await call('delete_space', { id: sp.id }))[0]).toBe(false);
    expect((await call('update_space', { id: sp.id, name: 'x' }))[1].code).toBe('not_found');
  });

  // PLNRAPP-861: withContent is z.stringbool(); the MCP SDK has already parsed it, no second parse
  it('delete_space через MCP: withContent="true"/"yes" удаляет с проектами, "maybe" — ошибка', async () => {
    const call = await mcp(admin);
    const spaceWith2 = async (name: string, key: string) => {
      const [e, sp] = await call('create_space', { name });
      expect(e, JSON.stringify(sp)).toBe(false);
      const ids: string[] = [];
      for (const k of ['A', 'B']) {
        const [ep, p] = await call('create_project', { spaceId: sp.id, name: k, key: key + k });
        expect(ep, JSON.stringify(p)).toBe(false);
        ids.push(p.id);
      }
      return { id: sp.id as string, projects: ids };
    };
    const left = async (s: { id: string; projects: string[] }) => [
      (await db.select().from(schema.spaces).where(eq(schema.spaces.id, s.id))).length,
      (await db.select().from(schema.projects).where(inArray(schema.projects.id, s.projects)))
        .length,
    ];

    const bad = await spaceWith2('Maybe', 'MBX');
    const [eb, rb] = await call('delete_space', { id: bad.id, withContent: 'maybe' });
    expect(eb).toBe(true);
    expect(String(rb)).toMatch(/validation/i);
    expect(await left(bad)).toEqual([1, 2]);

    for (const [v, key] of [
      ['true', 'TRX'],
      ['yes', 'YSX'],
    ] as const) {
      const s = await spaceWith2('С содержимым ' + v, key);
      const [e, r] = await call('delete_space', { id: s.id, withContent: v });
      expect(e, JSON.stringify(r)).toBe(false);
      expect(await left(s), v).toEqual([0, 0]);
    }
    expect((await call('delete_space', { id: bad.id, withContent: 'true' }))[0]).toBe(false);
  });

  it('проект: создать (в т. ч. с копией словарей) → состав → удалить', async () => {
    const call = await mcp(admin);
    const [e0, p1] = await call('create_project', {
      spaceId: w.spaceId,
      name: 'Один',
      key: 'ONE',
      modules: ['time'],
    });
    expect(e0, JSON.stringify(p1)).toBe(false);
    expect([p1.key, p1.membersMode, p1.spaceId]).toEqual(['ONE', 'inherit', w.spaceId]);
    const [e1, p2] = await call('create_project', {
      spaceId: w.spaceId,
      name: 'Два',
      key: 'TWO',
      copyFromProjectId: w.projectId,
    });
    expect(e1, JSON.stringify(p2)).toBe(false);
    expect((await call('copy_project_dictionaries', { id: p1.id, fromProjectId: p2.id }))[0]).toBe(
      false,
    );
    expect(
      (await rest(admin, 'POST', '/projects', { spaceId: w.spaceId, name: 'x', key: 'bad' }))[0],
    ).toBe(400);

    const [, inh] = await call('list_project_members', { id: p1.id });
    expect(inh.membersMode).toBe('inherit');
    expect(inh.members.map((m: Mem) => m.userId)).toContain(w.guest.userId);
    const [e2, bad] = await call('add_project_member', {
      id: p1.id,
      userId: w.member.userId,
      role: 'member',
    });
    expect([e2, bad.code]).toEqual([true, 'conflict']);
    const [e3, cus] = await call('set_project_members_mode', {
      id: p1.id,
      mode: 'custom',
      members: [{ userId: w.admin.userId, role: 'admin' }],
    });
    expect(e3, JSON.stringify(cus)).toBe(false);
    expect(cus.membersMode).toBe('custom');
    expect(
      (await call('add_project_member', { id: p1.id, userId: w.member.userId, role: 'guest' }))[1]
        .role,
    ).toBe('guest');
    expect(
      (
        await call('update_project_member', { id: p1.id, userId: w.member.userId, role: 'member' })
      )[1].role,
    ).toBe('member');
    expect((await call('remove_project_member', { id: p1.id, userId: w.member.userId }))[0]).toBe(
      false,
    );
    expect(
      (await call('remove_project_member', { id: p1.id, userId: w.member.userId }))[1].code,
    ).toBe('not_found');
    const [, back] = await call('set_project_members_mode', { id: p1.id, mode: 'inherit' });
    expect(back.membersMode).toBe('inherit');

    // tasks of p2 go to p1 in a batch, then p1 goes to another space with them
    const tasks: string[] = [];
    for (const title of ['a', 'b']) {
      const [et, tk] = await call('create_task', { projectId: p2.id, title });
      expect(et, JSON.stringify(tk)).toBe(false);
      tasks.push(tk.id);
    }
    const [eb, batch] = await call('batch_update_tasks', {
      taskIds: tasks,
      patch: { projectId: p1.id },
    });
    expect(eb, JSON.stringify(batch)).toBe(false);
    expect([batch.changed, batch.errors]).toEqual([2, []]);
    const [es, sp] = await call('create_space', { name: 'Куда' });
    expect(es, JSON.stringify(sp)).toBe(false);
    const [em, mv] = await call('move_project', { id: p1.id, spaceId: sp.id });
    expect(em, JSON.stringify(mv)).toBe(false);
    expect(mv.spaceId).toBe(sp.id);
    const [, moved] = await call('get_task', { task: tasks[0] });
    expect([moved.projectId, moved.key.startsWith('ONE-')]).toEqual([p1.id, true]);
    for (const id of tasks) await call('delete_task', { task: id });

    expect((await call('delete_project', { id: p1.id }))[0]).toBe(false);
    expect((await call('delete_project', { id: p1.id }))[1].code).toBe('not_found');
    expect((await rest(admin, 'DELETE', `/projects/${p2.id}`))[0]).toBe(204);
  });

  it('отказы: чужой — not_found, участник не админ и токен read — forbidden', async () => {
    const out = await mcp(outsider);
    for (const [tool, args] of [
      ['update_space', { id: w.spaceId, name: 'x' }],
      ['delete_space', { id: w.spaceId }],
      ['list_space_members', { id: w.spaceId }],
      ['add_space_member', { id: w.spaceId, userId: w.outsider.userId, role: 'admin' }],
      ['create_project', { spaceId: w.spaceId, name: 'x', key: 'XX' }],
      ['delete_project', { id: w.projectId }],
      ['list_project_members', { id: w.projectId }],
      ['set_space_members_mode', { id: w.spaceId, mode: 'inherit' }],
      ['set_project_members_mode', { id: w.projectId, mode: 'inherit' }],
      ['copy_project_dictionaries', { id: w.projectId, fromProjectId: w.projectId }],
    ] as const) {
      const [e, r] = await out(tool, args);
      expect([tool, e, r.code]).toEqual([tool, true, 'not_found']);
    }
    const mem = await mcp(member);
    for (const [tool, args] of [
      ['update_space', { id: w.spaceId, name: 'x' }],
      ['add_space_member', { id: w.spaceId, userId: w.outsider.userId, role: 'member' }],
      ['delete_project', { id: w.projectId }],
      ['set_space_members_mode', { id: w.spaceId, mode: 'inherit' }],
      [
        'set_project_members_mode',
        { id: w.projectId, mode: 'custom', members: [{ userId: w.member.userId, role: 'admin' }] },
      ],
    ] as const) {
      const [e, r] = await mem(tool, args);
      expect([tool, e, r.code]).toEqual([tool, true, 'forbidden']);
    }
    const ro = await mcp(read);
    for (const o of area.ops.filter((x) => x.write)) {
      const [e, r] = await ro(o.tool, {
        id: w.spaceId,
        spaceId: w.spaceId,
        userId: w.member.userId,
        name: 'x',
        key: 'RO',
        role: 'member',
        mode: 'inherit',
        fromProjectId: w.projectId,
      });
      expect([o.tool, e, r.code]).toEqual([o.tool, true, 'forbidden']);
    }
    expect((await ro('list_space_members', { id: w.spaceId }))[0]).toBe(false);
    expect((await rest(read, 'POST', '/spaces', { name: 'x' }))[0]).toBe(403);
    expect((await rest(outsider, 'GET', `/spaces/${w.spaceId}/members`))[0]).toBe(404);
  });
});
