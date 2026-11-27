// PLNRAPP-890: github.com connections of the levels workspace / space / project (as GitLab) — the token is
// checked at GitHub (mocked fetch), stored encrypted; disconnecting deletes the connection
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { decrypt, secretKey } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import { api as githubApi, githubToken, resolveConnection } from '@planar/module-github/api';
import { githubChoices as C, githubConnections as G } from '@planar/module-github/api/schema';
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { key as pkey, world, type World } from '../sync/helpers.js';

useApp();

const WS = '00000000-0000-0000-0000-000000000000';
const KEY = randomBytes(32).toString('base64');
const TOKEN = 'ghp_SECRET-token-value';
let w: World;
let cookie: string;
let adminId: string;
let gh: { url: string; auth: string | null }[];
let reply: (auth: string | null) => Promise<Response>;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  w = await world(db);
  adminId = (await createUser(db, { role: 'admin' })).id;
  cookie = await loginCookie(db, adminId);
});
beforeEach(async () => {
  process.env.PLANAR_SECRET_KEY = KEY;
  gh = [];
  // the login is the token's tail: different tokens — different GitHub accounts
  reply = async (auth) => Response.json({ login: `octo-${auth?.slice(-4)}`, id: 1 });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.github.com/')) return realFetch(input, init);
    const auth = new Headers(init?.headers).get('authorization');
    gh.push({ url, auth });
    return reply(auth);
  });
  await db.delete(C);
  await db.delete(G);
});
afterEach(() => vi.restoreAllMocks());

const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: method as 'GET',
      url: `/api/github/${url}`,
      payload: body as object | undefined,
      headers: { cookie, origin: ORIGIN, ...headers },
    });
const connect = (scope: string, scopeId: string, token = TOKEN) =>
  call('POST', 'connections', { scope, scopeId, token });
const add = async (scope: string, scopeId: string, token = TOKEN) => {
  const r = await connect(scope, scopeId, token);
  expect(r.statusCode).toBe(201);
  return r.json().connection.id as string;
};
const levelOf = async (scope: string, id: string) =>
  (await call('GET', `levels/${scope}/${id}`)).json() as {
    connections: { id: string; login: string; scope: string }[];
    choice: string | null;
    effective: string | null;
  };
const choose = (scope: string, id: string, connectionId: string | null) =>
  call('PUT', `levels/${scope}/${id}/choice`, { connectionId });
const eff = async () => (await resolveConnection(db, 'project', w.projectId))?.id ?? null;
const mkProject = async () => {
  const id = uuidv7();
  await w.admin.ok('project.create', {
    id,
    spaceId: w.spaceId,
    name: 'P2',
    key: pkey(),
    rank: 'b0',
  });
  return id;
};

describe('github: подключение', () => {
  it('модуль установлен', () => expect(githubApi.id).toBe('github'));

  it('валидный токен: 1 запись, токен зашифрован и расшифровывается в исходный', async () => {
    const r = await connect('workspace', WS);
    expect(r.statusCode).toBe(201);
    expect(r.json().connection).toMatchObject({
      scope: 'workspace',
      scopeId: WS,
      login: 'octo-alue',
      connectedBy: adminId,
    });
    expect(gh).toEqual([{ url: 'https://api.github.com/user', auth: `Bearer ${TOKEN}` }]);
    const rows = await db.select().from(G);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenEnc).not.toBe(TOKEN);
    expect(rows[0]!.tokenEnc).not.toContain(TOKEN);
    expect(decrypt(rows[0]!.tokenEnc, secretKey()!)).toBe(TOKEN);
    expect(await githubToken(db)).toBe(TOKEN);
    expect(await githubToken(db, 'project', w.projectId)).toBe(TOKEN);
  });

  it('состояние уровня: логин без токена ни в открытом, ни в зашифрованном виде', async () => {
    expect((await call('GET', `levels/workspace/${WS}`)).json()).toEqual({
      connections: [],
      choice: null,
      effective: null,
    });
    const id = await add('workspace', WS);
    const r = await call('GET', `levels/workspace/${WS}`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ effective: id, connections: [{ id, login: 'octo-alue' }] });
    const [row] = await db.select().from(G);
    expect(r.body).not.toContain(TOKEN);
    expect(r.body).not.toContain(row!.tokenEnc);
    expect(r.body).not.toContain('token');
  });

  it.each([401, 403])('GitHub отвечает %i: 4xx с понятной ошибкой, записи нет', async (st) => {
    reply = async () => Response.json({ message: 'Bad credentials' }, { status: st });
    const r = await connect('workspace', WS, 'ghp_bad');
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(r.statusCode).toBeLessThan(500);
    expect(r.json().message).toBe('Токен GitHub недействителен или не имеет доступа');
    expect(await db.select().from(G)).toHaveLength(0);
    expect(await db.select().from(C)).toHaveLength(0);
  });

  it('сетевая ошибка: «GitHub недоступен», записи нет', async () => {
    reply = async () => {
      throw new TypeError('fetch failed');
    };
    const r = await connect('project', w.projectId);
    expect(r.statusCode).toBe(502);
    expect(r.json().message).toBe('GitHub недоступен, попробуйте позже');
    expect(await db.select().from(G)).toHaveLength(0);
    expect(await db.select().from(C)).toHaveLength(0);
  });

  it('пустой токен, неверный уровень — 400/404 без запроса к GitHub', async () => {
    expect((await connect('workspace', WS, ' ')).statusCode).toBe(400);
    expect((await connect('team', WS)).statusCode).toBe(400);
    expect((await connect('workspace', uuidv7())).statusCode).toBe(404);
    expect((await connect('project', uuidv7())).statusCode).toBe(404);
    expect(gh).toHaveLength(0);
  });

  it('отключение удаляет подключение', async () => {
    const id = await add('workspace', WS);
    expect(await db.select().from(G)).toHaveLength(1);
    expect((await call('DELETE', `connections/${id}`)).statusCode).toBe(204);
    expect(await db.select().from(G)).toHaveLength(0);
    expect((await levelOf('workspace', WS)).connections).toEqual([]);
    expect(await githubToken(db)).toBeNull();
    expect((await call('DELETE', `connections/${id}`)).statusCode).toBe(404);
  });

  it('только администратор экземпляра', async () => {
    const id = await add('workspace', WS);
    gh = [];
    const m = await loginCookie(db, (await createUser(db, { role: 'member' })).id);
    const h = { cookie: m };
    expect((await call('GET', `levels/workspace/${WS}`, undefined, h)).statusCode).toBe(403);
    expect(
      (await call('POST', 'connections', { scope: 'workspace', scopeId: WS, token: TOKEN }, h))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('PUT', `levels/workspace/${WS}/choice`, { connectionId: id }, h)).statusCode,
    ).toBe(403);
    expect((await call('DELETE', `connections/${id}`, undefined, h)).statusCode).toBe(403);
    expect(gh).toHaveLength(0);
    expect(await db.select().from(G)).toHaveLength(1);
  });
});

describe('github: подключения по уровням (как GitLab)', () => {
  it('эффективное: проект → пространство → воркспейс; без выбора — самое старое глобальное', async () => {
    const ws = await add('workspace', WS, 'ghp_wsA1');
    const second = await add('workspace', WS, 'ghp_wsB2');
    expect(await eff()).toBe(ws);
    expect((await levelOf('project', w.projectId)).effective).toBe(ws);
    expect((await choose('workspace', WS, second)).statusCode).toBe(200);
    expect(await eff()).toBe(second);
    const sp = await add('space', w.spaceId, 'ghp_spC3');
    expect(await eff()).toBe(sp);
    expect((await levelOf('space', w.spaceId)).choice).toBe(sp);
    const lv = await levelOf('project', w.projectId);
    expect(lv.connections.map((x) => x.id).sort()).toEqual([ws, second, sp].sort());
    const pr = await add('project', w.projectId, 'ghp_prD4');
    expect(await eff()).toBe(pr);
    expect(await githubToken(db, 'project', w.projectId)).toBe('ghp_prD4');
    expect((await choose('project', w.projectId, null)).statusCode).toBe(200);
    expect(await eff()).toBe(sp);
    expect((await choose('space', w.spaceId, null)).statusCode).toBe(200);
    expect(await eff()).toBe(second);
  });

  it('выбор чужого подключения (своё у другого проекта) → 400', async () => {
    const p2 = await mkProject();
    const foreign = await add('project', p2);
    expect((await choose('project', w.projectId, foreign)).statusCode).toBe(400);
    expect((await choose('project', w.projectId, uuidv7())).statusCode).toBe(400);
  });

  it('отключение: уровни, выбравшие подключение, переходят на наследование', async () => {
    const ws = await add('workspace', WS, 'ghp_wsA1');
    const second = await add('workspace', WS, 'ghp_wsB2');
    await choose('project', w.projectId, second);
    expect(await eff()).toBe(second);
    expect((await call('DELETE', `connections/${second}`)).statusCode).toBe(204);
    expect((await levelOf('project', w.projectId)).choice).toBeNull();
    expect(await eff()).toBe(ws);
    expect(await db.select().from(C)).toHaveLength(0);
  });

  it('удаление проекта убирает его собственные подключения и выбор', async () => {
    const p2 = await mkProject();
    await add('project', p2);
    await w.admin.ok('project.delete', { id: p2 });
    expect(await db.select().from(G).where(eq(G.scopeId, p2))).toHaveLength(0);
    expect(await db.select().from(C).where(eq(C.scopeId, p2))).toHaveLength(0);
  });
});
