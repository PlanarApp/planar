// PLNRAPP-890: the github.com connection — the token is checked at GitHub (mocked fetch), stored encrypted
import { randomBytes } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { decrypt, secretKey } from '@planar/server-kit';
import { api as githubApi, githubToken } from '@planar/module-github/api';
import { githubConnections as G } from '@planar/module-github/api/schema';
import { settings } from '../../src/db/schema.js';
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';

useApp();

const KEY = randomBytes(32).toString('base64');
const TOKEN = 'ghp_SECRET-token-value';
let cookie: string;
let adminId: string;
let gh: { url: string; auth: string | null }[];
let reply: () => Promise<Response>;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  await db
    .insert(settings)
    .values({ id: 'enabled_modules', value: ['github'] })
    .onConflictDoUpdate({ target: settings.id, set: { value: ['github'] } });
  adminId = (await createUser(db, { role: 'admin' })).id;
  cookie = await loginCookie(db, adminId);
});
beforeEach(async () => {
  process.env.PLANAR_SECRET_KEY = KEY;
  gh = [];
  reply = async () => Response.json({ login: 'octo-cat', id: 1 });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith('https://api.github.com/')) return realFetch(input, init);
    gh.push({ url, auth: new Headers(init?.headers).get('authorization') });
    return reply();
  });
  await db.delete(G);
});
afterEach(() => vi.restoreAllMocks());

const call = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: method as 'GET',
      url: '/api/github/connection',
      payload: body as object | undefined,
      headers: { cookie, origin: ORIGIN, ...headers },
    });

describe('github: подключение', () => {
  it('модуль установлен', () => expect(githubApi.id).toBe('github'));

  it('валидный токен: 1 запись, токен зашифрован и расшифровывается в исходный', async () => {
    const r = await call('PUT', { token: TOKEN });
    expect(r.statusCode).toBe(200);
    expect(r.json().connection).toMatchObject({ login: 'octo-cat', connectedBy: adminId });
    expect(gh).toEqual([{ url: 'https://api.github.com/user', auth: `Bearer ${TOKEN}` }]);
    const rows = await db.select().from(G);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenEnc).not.toBe(TOKEN);
    expect(rows[0]!.tokenEnc).not.toContain(TOKEN);
    expect(decrypt(rows[0]!.tokenEnc, secretKey()!)).toBe(TOKEN);
    expect(await githubToken(db)).toBe(TOKEN);
    // reconnecting replaces the connection
    expect((await call('PUT', { token: TOKEN })).statusCode).toBe(200);
    expect(await db.select().from(G)).toHaveLength(1);
  });

  it('состояние: логин без токена ни в открытом, ни в зашифрованном виде', async () => {
    expect((await call('GET')).json()).toEqual({ connection: null });
    await call('PUT', { token: TOKEN });
    const r = await call('GET');
    expect(r.statusCode).toBe(200);
    expect(r.json().connection.login).toBe('octo-cat');
    const [row] = await db.select().from(G);
    expect(r.body).not.toContain(TOKEN);
    expect(r.body).not.toContain(row!.tokenEnc);
    expect(r.body).not.toContain('token');
  });

  it.each([401, 403])('GitHub отвечает %i: 4xx с понятной ошибкой, записи нет', async (st) => {
    reply = async () => Response.json({ message: 'Bad credentials' }, { status: st });
    const r = await call('PUT', { token: 'ghp_bad' });
    expect(r.statusCode).toBeGreaterThanOrEqual(400);
    expect(r.statusCode).toBeLessThan(500);
    expect(r.json().message).toBe('Токен GitHub недействителен или не имеет доступа');
    expect(await db.select().from(G)).toHaveLength(0);
  });

  it('сетевая ошибка: «GitHub недоступен», записи нет', async () => {
    reply = async () => {
      throw new TypeError('fetch failed');
    };
    const r = await call('PUT', { token: TOKEN });
    expect(r.statusCode).toBe(502);
    expect(r.json().message).toBe('GitHub недоступен, попробуйте позже');
    expect(await db.select().from(G)).toHaveLength(0);
  });

  it('пустой токен — 400 без запроса к GitHub', async () => {
    expect((await call('PUT', { token: ' ' })).statusCode).toBe(400);
    expect(gh).toHaveLength(0);
  });

  it('отключение удаляет подключение', async () => {
    await call('PUT', { token: TOKEN });
    expect(await db.select().from(G)).toHaveLength(1);
    expect((await call('DELETE')).statusCode).toBe(204);
    expect(await db.select().from(G)).toHaveLength(0);
    expect((await call('GET')).json()).toEqual({ connection: null });
    expect(await githubToken(db)).toBeNull();
  });

  it('только администратор экземпляра', async () => {
    const m = await loginCookie(db, (await createUser(db, { role: 'member' })).id);
    expect((await call('GET', undefined, { cookie: m })).statusCode).toBe(403);
    expect((await call('PUT', { token: TOKEN }, { cookie: m })).statusCode).toBe(403);
    expect((await call('DELETE', undefined, { cookie: m })).statusCode).toBe(403);
    expect(gh).toHaveLength(0);
  });
});
