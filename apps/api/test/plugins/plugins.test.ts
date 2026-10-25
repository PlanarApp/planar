import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { checkPluginUrl } from '@planar/module-plugins/shared';
import { createBridge, type BridgeDeps } from '../../../../modules/plugins/web/bridge.js';
import {
  ensureFrameCsp,
  ensureWhenLoaded,
  frameAllowed,
  resetFrameCsp,
} from '../../../../modules/plugins/web/csp.js';
import { pluginsPlugins as P } from '@planar/module-plugins/api/schema';
import { settings } from '../../src/db/schema.js';
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, req, useApp } from '../auth/harness.js';
import { doc, taskArgs, world, type World } from '../sync/helpers.js';

useApp();

let w: World;
let admin: string;
let member: string;
let taskId: string;
let bearer: string;

const call = (
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = { cookie: admin },
) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: method as 'GET',
      url: `/api/plugins/${url}`,
      payload: body as object | undefined,
      headers: { origin: ORIGIN, ...headers },
    });
const reg = (over: Record<string, unknown> = {}) => {
  const id = uuidv7();
  return call('POST', 'admin', {
    id,
    name: 'Hello',
    url: 'https://plugin.example/index.html',
    permissions: { read: ['tasks', 'comments', 'users'], write: ['comments'] },
    points: { taskPanel: { label: 'H' }, page: null },
    ...over,
  }).then((r) => ({ r, id }));
};
const commentBody = (id = uuidv7()) => ({
  name: 'comment.create',
  args: { id, taskId, body: doc('hi') },
});

beforeAll(async () => {
  w = await world(db);
  await db
    .insert(settings)
    .values({ id: 'enabled_modules', value: ['plugins'] })
    .onConflictDoUpdate({ target: settings.id, set: { value: ['plugins'] } });
  admin = await loginCookie(db, (await createUser(db, { role: 'admin' })).id);
  const m = await createUser(db, { role: 'member' });
  member = await loginCookie(db, m.id);
  await w.admin.ok('member.add', {
    id: uuidv7(),
    spaceId: w.spaceId,
    userId: m.id,
    role: 'member',
  });
  taskId = uuidv7();
  await w.admin.ok('task.create', taskArgs(w, { id: taskId }));
  const tok = await getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/tokens',
      payload: { name: 't', scope: 'write' },
      headers: { cookie: member, origin: ORIGIN },
    });
  bearer = tok.json().secret;
});

describe('pf5: checkPluginUrl', () => {
  const app = 'http://localhost:5173';
  it('pf5: годные: https на чужом хосте; http localhost только вне prod', () => {
    expect(checkPluginUrl('https://p.example/x', app, true)).toBeNull();
    expect(checkPluginUrl('http://127.0.0.1:9000/', app, false)).toBeNull();
  });
  it('pf5: отказ: хост приложения, тот же хост на другом порту', () => {
    expect(checkPluginUrl('http://localhost:5173/', app, false)).toBe('same_host');
    expect(checkPluginUrl('http://localhost:9999/', app, false)).toBe('same_host');
    expect(checkPluginUrl('https://app.example:8443/', 'https://app.example', true)).toBe(
      'same_host',
    );
  });
  it('pf5: отказ: javascript:, userinfo, http не localhost, http в prod, мусор', () => {
    expect(checkPluginUrl('javascript:alert(1)', app, false)).not.toBeNull();
    expect(checkPluginUrl('https://u:p@p.example/', app, false)).toBe('userinfo');
    expect(checkPluginUrl('http://p.example/', app, false)).toBe('scheme');
    expect(checkPluginUrl('http://127.0.0.1:9000/', app, true)).toBe('scheme');
    expect(checkPluginUrl('nope', app, false)).toBe('invalid_url');
  });
});

describe('pf5: REST admin', () => {
  it('pf5: создание, правка, выключение, удаление (origin из url)', async () => {
    const { r, id } = await reg();
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ id, origin: 'https://plugin.example', enabled: true });
    const p = await call('PATCH', `admin/${id}`, { enabled: false, name: 'N' });
    expect(p.json()).toMatchObject({ enabled: false, name: 'N' });
    expect((await call('PATCH', `admin/${uuidv7()}`, {})).statusCode).toBe(404);
    expect((await call('DELETE', `admin/${id}`)).statusCode).toBe(204);
    expect(await db.select().from(P).where(eq(P.id, id))).toHaveLength(0);
  });
  it('pf5: плохой url, write не из read, нет точки → 400', async () => {
    expect((await reg({ url: 'http://localhost:5173/' })).r.statusCode).toBe(400);
    expect((await reg({ url: 'javascript:alert(1)' })).r.statusCode).toBe(400);
    expect(
      (await reg({ permissions: { read: ['tasks'], write: ['comments'] } })).r.statusCode,
    ).toBe(400);
    expect((await reg({ points: { taskPanel: null, page: null } })).r.statusCode).toBe(400);
  });
  it('pf5: не админ → 403, Bearer → 403', async () => {
    expect((await call('POST', 'admin', {}, { cookie: member })).statusCode).toBe(403);
    expect(
      (await call('POST', 'admin', {}, { authorization: `Bearer ${bearer}` })).statusCode,
    ).toBe(403);
  });
  it('pf5: клиентская запись сущности (sync) запрещена — write: server', async () => {
    const r = await w.admin.push('plugins.save', {
      id: uuidv7(),
      name: 'x',
      url: 'https://p.example/',
      permissions: { read: [], write: [] },
      points: { taskPanel: { label: 'a' }, page: null },
      enabled: true,
    });
    expect(r).toMatchObject({ ok: false, code: 'forbidden' });
  });
});

describe('pf5: POST /:id/mutate', () => {
  let pid: string;
  beforeEach(async () => {
    pid = (await reg()).id;
  });
  it('pf5: разрешённый мутатор выполняется от пользователя сессии', async () => {
    const id = uuidv7();
    expect(
      (await call('POST', `${pid}/mutate`, commentBody(id), { cookie: member })).statusCode,
    ).toBe(204);
    const { rows } = await db.$client.query('select author_id from comments where id = $1', [id]);
    expect(rows).toHaveLength(1);
  });
  it('pf5: мутатор вне прав плагина → 403', async () => {
    const r = await call(
      'POST',
      `${pid}/mutate`,
      { name: 'task.update', args: { id: taskId, title: 'x' } },
      { cookie: member },
    );
    expect(r.statusCode).toBe(403);
  });
  it('pf5: выключенный плагин и неизвестный плагин → 403', async () => {
    await call('PATCH', `admin/${pid}`, { enabled: false });
    expect(
      (await call('POST', `${pid}/mutate`, commentBody(), { cookie: member })).statusCode,
    ).toBe(403);
    expect(
      (await call('POST', `${uuidv7()}/mutate`, commentBody(), { cookie: member })).statusCode,
    ).toBe(403);
  });
  it('pf5: Bearer → 403, без входа → 401', async () => {
    const h = { authorization: `Bearer ${bearer}` };
    expect((await call('POST', `${pid}/mutate`, commentBody(), h)).statusCode).toBe(403);
    expect((await call('POST', `${pid}/mutate`, commentBody(), {})).statusCode).toBe(401);
  });
  it('pf5: права пользователя тоже действуют (чужая задача → ошибка мутатора)', async () => {
    const outsider = await loginCookie(db, (await createUser(db, { role: 'member' })).id);
    const r = await call('POST', `${pid}/mutate`, commentBody(), { cookie: outsider });
    expect([403, 404]).toContain(r.statusCode);
  });
});

describe('pf5: cookie', () => {
  it('pf5: Set-Cookie planar_sid при входе без Domain (host-only)', async () => {
    const { hashPassword } = await import('../../src/auth/password.js');
    const { users } = await import('../../src/db/schema.js');
    await db.insert(users).values({
      login: 'pfcookie',
      name: 'c',
      role: 'member',
      passwordHash: await hashPassword('password1'),
    });
    const r = await req('POST', '/api/auth/login', {
      body: { login: 'pfcookie', password: 'password1' },
      origin: null,
    });
    const c = String(r.headers['set-cookie']);
    expect(c).toMatch(/^planar_sid=/);
    expect(c).not.toMatch(/domain=/i);
  });
});

describe('pf5: мост postMessage', () => {
  const ORIGIN_P = 'https://plugin.example';
  const frame = { postMessage: vi.fn() };
  const plugin = {
    id: 'p1',
    origin: ORIGIN_P,
    permissions: {
      read: ['tasks', 'users'] as ('tasks' | 'users')[],
      write: ['comments'] as 'comments'[],
    },
  };
  const deps = {
    query: vi.fn(async () => [
      { id: 'u1', name: 'A', login: 'a', avatarFile: null, passwordHash: 'x' },
    ]),
    mutate: vi.fn(async () => {}),
    navigate: vi.fn(),
    resize: vi.fn(),
    user: { id: 'u', name: 'N', login: 'l', role: 'member' },
    context: { point: 'taskPanel', taskId: 't', projectId: 'p', spaceId: 's' },
    locale: 'ru',
    theme: 'light',
  } as unknown as BridgeDeps;
  const bridge = createBridge(frame, plugin, deps);
  const send = (data: unknown, o: { origin?: string; source?: unknown } = {}) =>
    bridge.onMessage({ origin: ORIGIN_P, source: frame, data, ...o });
  const last = () => frame.postMessage.mock.calls.at(-1)!;
  beforeEach(() => vi.clearAllMocks());

  it('pf5: чужой origin, чужой source, planar≠1, неизвестный type → игнор без ответа', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await send({ planar: 1, type: 'ready' }, { origin: 'https://evil.example' });
    await send({ planar: 1, type: 'ready' }, { source: {} });
    await send({ planar: 2, type: 'ready' });
    await send({ planar: 1, type: 'nope' });
    await send(null);
    expect(frame.postMessage).not.toHaveBeenCalled();
  });
  it('pf5: ready → init; ответ только на origin плагина, не "*"', async () => {
    await send({ planar: 1, type: 'ready' });
    const [msg, target] = last();
    expect(target).toBe(ORIGIN_P);
    expect(msg).toMatchObject({
      planar: 1,
      type: 'init',
      plugin: { id: 'p1' },
      permissions: plugin.permissions,
    });
  });
  it('pf5: query вне read → forbidden; where не по индексу → invalid_request', async () => {
    await send({ planar: 1, type: 'query', id: '1', entity: 'comments' });
    expect(last()[0]).toMatchObject({ id: '1', ok: false, error: { code: 'forbidden' } });
    await send({ planar: 1, type: 'query', id: '2', entity: 'tasks', where: { title: 'x' } });
    expect(last()[0]).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    expect(deps.query).not.toHaveBeenCalled();
  });
  it('pf5: query users отдаёт только id, name, login, avatarFile; limit ≤ 500', async () => {
    await send({ planar: 1, type: 'query', id: '3', entity: 'users', where: { login: 'a' } });
    expect(last()[0].rows).toEqual([{ id: 'u1', name: 'A', login: 'a', avatarFile: null }]);
    await send({ planar: 1, type: 'query', id: '4', entity: 'tasks', limit: 501 });
    expect(last()[0]).toMatchObject({ ok: false });
  });
  it('pf5: mutate вне write → forbidden без запроса; в write → вызов', async () => {
    await send({ planar: 1, type: 'mutate', id: '5', name: 'task.update', args: {} });
    expect(last()[0]).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    expect(deps.mutate).not.toHaveBeenCalled();
    await send({ planar: 1, type: 'mutate', id: '6', name: 'comment.create', args: { a: 1 } });
    expect(deps.mutate).toHaveBeenCalledWith('p1', 'comment.create', { a: 1 });
    expect(last()[0]).toMatchObject({ id: '6', ok: true });
  });
  it('pf5: resize ограничен 40–2000; navigate "//x" и "/\\x" игнорируются', async () => {
    await send({ planar: 1, type: 'resize', height: 5 });
    await send({ planar: 1, type: 'resize', height: 99999 });
    expect(deps.resize).toHaveBeenNthCalledWith(1, 40);
    expect(deps.resize).toHaveBeenNthCalledWith(2, 2000);
    await send({ planar: 1, type: 'navigate', path: '//evil.example' });
    await send({ planar: 1, type: 'navigate', path: '/\\evil.example' });
    await send({ planar: 1, type: 'navigate', path: 'https://evil.example' });
    expect(deps.navigate).not.toHaveBeenCalled();
    await send({ planar: 1, type: 'navigate', path: '/m/x' });
    expect(deps.navigate).toHaveBeenCalledWith('/m/x');
  });
});

describe('pf5: CSP frame-src', () => {
  it('pf5: meta вставляется один раз; позже добавленный плагин не разрешён', () => {
    resetFrameCsp();
    const metas: { content: string }[] = [];
    const d = {
      createElement: () => ({ content: '', httpEquiv: '' }),
      head: { appendChild: (m: { content: string }) => metas.push(m) },
    } as unknown as Document;
    ensureFrameCsp(['https://a.example'], d);
    ensureFrameCsp(['https://a.example', 'https://b.example'], d);
    expect(metas).toHaveLength(1);
    expect(metas[0]!.content).toBe('frame-src https://a.example');
    expect(frameAllowed('https://a.example')).toBe(true);
    expect(frameAllowed('https://b.example')).toBe(false);
    resetFrameCsp();
    ensureFrameCsp([], d);
    expect(metas[1]!.content).toBe("frame-src 'none'");
    resetFrameCsp();
  });
  it('pf5: список не загружен (undefined) — CSP не фиксируется; пустой список — frame-src none', () => {
    resetFrameCsp();
    const metas: { content: string }[] = [];
    const d = {
      createElement: () => ({ content: '', httpEquiv: '' }),
      head: { appendChild: (m: { content: string }) => metas.push(m) },
    } as unknown as Document;
    expect(ensureWhenLoaded(undefined, d)).toBe(false);
    expect(metas).toHaveLength(0);
    expect(frameAllowed('https://a.example')).toBe(false);
    expect(ensureWhenLoaded(['https://a.example'], d)).toBe(true);
    expect(metas[0]!.content).toBe('frame-src https://a.example');
    resetFrameCsp();
  });
});
