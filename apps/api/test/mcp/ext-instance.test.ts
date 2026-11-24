import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { apiTokenCreatedSchema } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { toolDefs } from '../../src/mcp/tools.js';
import { area } from '../../src/rest/ext/instance.js';
import { RestService } from '../../src/rest/rest.service.js';
import { createUser, ORIGIN, loginCookie } from '../auth.js';
import { dbUrl, newDb, world, type World } from '../sync/helpers.js';

// PLNRAPP-272 (IN-1): instance users, modules and workspace name over REST v1 and MCP; instance admin only
const PARITY_INSTANCE: Record<string, string> = {
  'GET /api/v1/instance/users': 'list_users',
  'POST /api/v1/instance/users': 'create_user',
  'PATCH /api/v1/instance/users/{id}': 'update_user',
  'GET /api/v1/instance': 'get_instance',
  'PATCH /api/v1/instance/workspace': 'update_workspace',
  'PUT /api/v1/instance/modules/{id}': 'set_instance_module',
};

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let base: string;
let w: World;
let admin: string; // instance admin, write
let adminRead: string;
let owner: string;
let member: string; // instance role member
let ownerId: string;
let adminId: string;

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
  adminId = (await createUser(db, { role: 'admin' })).id;
  ownerId = (await createUser(db, { role: 'owner' })).id;
  admin = await issue(adminId, 'write');
  adminRead = await issue(adminId, 'read');
  owner = await issue(ownerId, 'write');
  member = await issue(w.member.userId, 'write');
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

type U = { id: string; login: string; role: string; deactivatedAt: string | null };

describe('инстанс (ext/instance)', () => {
  it('PARITY_INSTANCE равен операциям области; чтение — read-токеном', () => {
    expect(
      Object.fromEntries(area.ops.map((o) => [`${o.method.toUpperCase()} ${o.path}`, o.tool])),
    ).toEqual(PARITY_INSTANCE);
    const defs = toolDefs(app.get(RestService));
    expect(defs.find((d) => d.name === 'list_users')?.write).toBe(false);
    expect(defs.find((d) => d.name === 'create_user')?.write).toBe(true);
    expect(area.ops.filter((o) => o.method === 'delete')).toEqual([]);
    // admin powers: the AI chat asks for confirmation (danger)
    for (const t of ['create_user', 'update_user', 'update_workspace', 'set_instance_module'])
      expect(defs.find((d) => d.name === t)?.danger, t).toBe('delete');
  });

  it('пользователи: список без секретов → создать → роль → блокировка', async () => {
    const call = await mcp(admin);
    const [e0, list] = await call('list_users');
    expect(e0, JSON.stringify(list)).toBe(false);
    expect(list.map((u: U) => u.id)).toContain(w.member.userId);
    expect(JSON.stringify(list)).not.toMatch(/passwordHash|password_hash/);

    const [e1, u] = await call('create_user', {
      login: 'New.User',
      name: 'Новый',
      password: 'secret-pass-1',
      role: 'member',
    });
    expect(e1, JSON.stringify(u)).toBe(false);
    expect([u.login, u.role]).toEqual(['new.user', 'member']);
    expect(JSON.stringify(u)).not.toMatch(/passwordHash|secret-pass-1/);
    expect(
      (
        await call('create_user', {
          login: 'new.user',
          name: 'x',
          password: 'secret-pass-1',
          role: 'guest',
        })
      )[1].code,
    ).toBe('conflict');
    expect(
      (
        await rest(admin, 'POST', '/instance/users', {
          login: 'o1',
          name: 'x',
          password: 'secret-pass-1',
          role: 'owner',
        })
      )[0],
    ).toBe(400);

    expect(
      (await call('update_user', { id: u.id, role: 'guest', name: 'Гость' }))[1],
    ).toMatchObject({ role: 'guest', name: 'Гость' });
    const [, off] = await call('update_user', { id: u.id, deactivated: true });
    expect(off.deactivatedAt).toBeTruthy();
    expect(
      (await call('update_user', { id: u.id, deactivated: false }))[1].deactivatedAt,
    ).toBeNull();
    expect(
      (await call('update_user', { id: '00000000-0000-7000-8000-000000000000', name: 'x' }))[1]
        .code,
    ).toBe('not_found');

    // REST: the same operations
    const [s1, b1] = await rest(admin, 'POST', '/instance/users', {
      login: 'viarest',
      name: 'R',
      password: 'secret-pass-2',
      role: 'member',
    });
    expect(s1).toBe(201);
    expect(
      (await rest(admin, 'PATCH', `/instance/users/${b1.data.id}`, { role: 'admin' }))[0],
    ).toBe(200);
    // an admin cannot touch another admin, the owner can
    expect(
      (await rest(admin, 'PATCH', `/instance/users/${b1.data.id}`, { role: 'member' }))[0],
    ).toBe(403);
    expect(
      (await rest(owner, 'PATCH', `/instance/users/${b1.data.id}`, { role: 'member' }))[0],
    ).toBe(200);
    expect((await rest(admin, 'GET', '/instance/users'))[0]).toBe(200);
  });

  it('правила ролей: владельца и себя (роль/блокировку) менять нельзя', async () => {
    const call = await mcp(admin);
    for (const args of [
      { id: ownerId, name: 'x' },
      { id: adminId, role: 'member' },
      { id: adminId, deactivated: true },
    ])
      expect([JSON.stringify(args), (await call('update_user', args))[1].code]).toEqual([
        JSON.stringify(args),
        'forbidden',
      ]);
    expect((await call('update_user', { id: adminId, name: 'Я' }))[1].name).toBe('Я');
  });

  it('workspace и модули инстанса', async () => {
    const call = await mcp(admin);
    const [, inst] = await call('get_instance');
    expect(inst.modules.length).toBeGreaterThan(0);
    const [e0, ws] = await call('update_workspace', { name: 'Моя компания' });
    expect([e0, ws.name]).toEqual([false, 'Моя компания']);
    expect((await call('get_instance'))[1].workspace.name).toBe('Моя компания');

    const was = inst.modules.find((m: { id: string }) => m.id === 'hello');
    expect(was, 'модуль hello установлен').toBeTruthy();
    const [e1, on] = await call('set_instance_module', { id: 'hello', enabled: !was.enabled });
    expect([e1, on]).toEqual([false, { id: 'hello', enabled: !was.enabled }]);
    expect(
      (await call('set_instance_module', { id: 'hello', enabled: was.enabled }))[1].enabled,
    ).toBe(was.enabled);
    expect((await call('set_instance_module', { id: 'nope', enabled: true }))[1].code).toBe(
      'invalid_request',
    );
    expect((await rest(admin, 'PATCH', '/instance/workspace', { name: '' }))[0]).toBe(400);
  });

  it('отказы: не админ инстанса и токен read — forbidden', async () => {
    const mem = await mcp(member);
    const calls = [
      ['list_users', {}],
      ['create_user', { login: 'zz', name: 'x', password: 'secret-pass-3', role: 'member' }],
      ['update_user', { id: w.admin.userId, name: 'x' }],
      ['get_instance', {}],
      ['update_workspace', { name: 'x' }],
      ['set_instance_module', { id: 'hello', enabled: true }],
    ] as const;
    for (const [tool, args] of calls) {
      const [e, r] = await mem(tool, args);
      expect([tool, e, r.code]).toEqual([tool, true, 'forbidden']);
    }
    const ro = await mcp(adminRead);
    for (const [tool, args] of calls.filter(([t]) => area.ops.find((o) => o.tool === t)!.write)) {
      const [e, r] = await ro(tool, args);
      expect([tool, e, r.code]).toEqual([tool, true, 'forbidden']);
    }
    expect((await ro('list_users'))[0]).toBe(false);
    expect((await rest(member, 'GET', '/instance/users'))[0]).toBe(403);
    expect(
      (
        await rest(adminRead, 'POST', '/instance/users', {
          login: 'zz',
          name: 'x',
          password: 'secret-pass-3',
          role: 'member',
        })
      )[0],
    ).toBe(403);
  });
});
