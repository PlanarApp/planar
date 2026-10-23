import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { apiTokenCreatedSchema, apiTokenSchema, uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { apiTokens, activity, users } from '../../src/db/schema.js';
import { hashToken } from '../../src/auth/sessions.js';
import { ORIGIN, createUser, loginCookie } from '../auth.js';
import { dbUrl, newDb, taskArgs, world } from '../sync/helpers.js';

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

type H = { cookie?: string; bearer?: string; origin?: string | null };
const req = (method: 'GET' | 'POST' | 'DELETE', url: string, h: H = {}, payload?: unknown) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method,
      url,
      payload: payload as object,
      headers: {
        ...(h.cookie && { cookie: h.cookie }),
        ...(h.bearer && { authorization: `Bearer ${h.bearer}` }),
        ...(h.origin !== null && !h.bearer && { origin: h.origin ?? ORIGIN }),
      },
    });

async function issue(cookie: string, scope: 'read' | 'write' = 'write', extra = {}) {
  const r = await req('POST', '/api/tokens', { cookie }, { name: 't', scope, ...extra });
  expect(r.statusCode).toBe(201);
  const b = apiTokenCreatedSchema.parse(r.json());
  return { secret: b.secret, id: b.token.id };
}
async function owner() {
  const u = await createUser(db);
  return { u, cookie: await loginCookie(db, u.id) };
}
const push = (bearer: string, clientId: string, mutations: unknown[]) =>
  req('POST', '/sync/push', { bearer }, { clientId, mutations });

describe('API-токены: выпуск и список', () => {
  it('секрет plnr_[0-9A-Za-z]{43}, в БД только sha256', async () => {
    const { cookie } = await owner();
    const { secret, id } = await issue(cookie);
    expect(secret).toMatch(/^plnr_[0-9A-Za-z]{43}$/);
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, id));
    expect(row!.tokenSha256).toBe(hashToken(secret));
    expect(row!.prefix).toBe(secret.slice(5, 13));
    expect(JSON.stringify(row)).not.toContain(secret);
  });

  it('список: свои, без secret, новые первыми', async () => {
    const a = await owner();
    const b = await owner();
    const t1 = await issue(a.cookie, 'read');
    const t2 = await issue(a.cookie, 'write');
    await issue(b.cookie);
    const r = await req('GET', '/api/tokens', { cookie: a.cookie });
    const tokens = r.json().tokens;
    expect(tokens.map((t: { id: string }) => t.id)).toEqual([t2.id, t1.id]);
    for (const t of tokens) expect(apiTokenSchema.safeParse(t).success).toBe(true);
    expect(r.body).not.toContain(t1.secret);
    expect(r.body).not.toContain('secret');
  });

  it('неверные name/scope/expiresAt → 400', async () => {
    const { cookie } = await owner();
    for (const body of [
      { name: '', scope: 'write' },
      { name: 'x', scope: 'admin' },
      { name: 'x', scope: 'read', expiresAt: new Date(Date.now() - 1000).toISOString() },
      { name: 'x', scope: 'read', expiresAt: 'вчера' },
    ]) {
      const r = await req('POST', '/api/tokens', { cookie }, body);
      expect(r.statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it('expiresAt в будущем и null принимаются', async () => {
    const { cookie } = await owner();
    await issue(cookie, 'read', { expiresAt: new Date(Date.now() + 86400_000).toISOString() });
    await issue(cookie, 'read', { expiresAt: null });
  });

  it('DELETE: 204, повторно/чужой/нет → 404', async () => {
    const a = await owner();
    const b = await owner();
    const t = await issue(a.cookie);
    expect((await req('DELETE', `/api/tokens/${t.id}`, { cookie: b.cookie })).statusCode).toBe(404);
    expect((await req('DELETE', `/api/tokens/${t.id}`, { cookie: a.cookie })).statusCode).toBe(204);
    expect((await req('DELETE', `/api/tokens/${t.id}`, { cookie: a.cookie })).statusCode).toBe(404);
    expect((await req('DELETE', `/api/tokens/${uuidv7()}`, { cookie: a.cookie })).statusCode).toBe(
      404,
    );
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, t.id));
    expect(row!.revokedAt).not.toBeNull();
  });
});

describe('Bearer-авторизация', () => {
  it('Bearer даёт /api/auth/me того же пользователя', async () => {
    const { u, cookie } = await owner();
    const { secret } = await issue(cookie);
    const r = await req('GET', '/api/auth/me', { bearer: secret });
    expect(r.statusCode).toBe(200);
    expect(JSON.stringify(r.json())).toContain(u.id);
  });

  it('отозванный → 401', async () => {
    const { cookie } = await owner();
    const t = await issue(cookie);
    await req('DELETE', `/api/tokens/${t.id}`, { cookie });
    const r = await req('GET', '/api/auth/me', { bearer: t.secret });
    expect(r.statusCode).toBe(401);
    expect(r.json().code).toBe('unauthenticated');
  });

  it('просроченный → 401', async () => {
    const { cookie } = await owner();
    const t = await issue(cookie, 'read', {
      expiresAt: new Date(Date.now() + 86400_000).toISOString(),
    });
    await db
      .update(apiTokens)
      .set({ expiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(apiTokens.id, t.id));
    expect((await req('GET', '/api/auth/me', { bearer: t.secret })).statusCode).toBe(401);
  });

  it('деактивированный владелец → 401', async () => {
    const { u, cookie } = await owner();
    const t = await issue(cookie);
    await db
      .update(users)
      .set({ deactivatedAt: new Date().toISOString() })
      .where(eq(users.id, u.id));
    expect((await req('GET', '/api/auth/me', { bearer: t.secret })).statusCode).toBe(401);
  });

  it('неизвестный токен → 401', async () => {
    const r = await req('GET', '/api/auth/me', { bearer: 'plnr_' + '0'.repeat(43) });
    expect(r.statusCode).toBe(401);
  });

  it('Bearer к /api/tokens → 403', async () => {
    const { cookie } = await owner();
    const { secret } = await issue(cookie);
    expect((await req('GET', '/api/tokens', { bearer: secret })).statusCode).toBe(403);
    const r = await req('POST', '/api/tokens', { bearer: secret }, { name: 'x', scope: 'read' });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('forbidden');
  });

  it('POST с Bearer без Origin — не origin_mismatch', async () => {
    const { cookie } = await owner();
    const { secret } = await issue(cookie);
    const r = await push(secret, uuidv7(), []);
    expect(r.statusCode).toBe(200);
  });

  it('last_used_at обновляется', async () => {
    const { cookie } = await owner();
    const t = await issue(cookie);
    await req('GET', '/api/auth/me', { bearer: t.secret });
    const [row] = await db.select().from(apiTokens).where(eq(apiTokens.id, t.id));
    expect(row!.lastUsedAt).not.toBeNull();
  });
});

describe('Права токена', () => {
  it('read: GET ok, POST /sync/push → 403', async () => {
    const { cookie } = await owner();
    const { secret } = await issue(cookie, 'read');
    expect((await req('GET', '/api/auth/me', { bearer: secret })).statusCode).toBe(200);
    expect(
      (await req('GET', `/sync/bootstrap?clientId=${uuidv7()}`, { bearer: secret })).statusCode,
    ).toBe(200);
    const r = await push(secret, uuidv7(), []);
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe('forbidden');
  });

  it('write: push проходит, activity.viaTokenId = id токена, по сессии — null', async () => {
    const w = await world(db);
    const cookie = await loginCookie(db, w.admin.userId);
    const t = await issue(cookie, 'write');
    const viaToken = taskArgs(w);
    const r = await push(t.secret, uuidv7(), [{ id: 1, name: 'task.create', args: viaToken }]);
    expect(r.json()).toEqual({ results: [{ id: 1, ok: true }] });
    const viaSession = taskArgs(w);
    await req(
      'POST',
      '/sync/push',
      { cookie },
      {
        clientId: uuidv7(),
        mutations: [{ id: 1, name: 'task.create', args: viaSession }],
      },
    );
    const act = async (taskId: unknown) =>
      (
        await db
          .select()
          .from(activity)
          .where(eq(activity.taskId, taskId as string))
      ).map((a) => a.viaTokenId);
    expect(await act(viaToken.id)).toEqual([t.id]);
    expect(await act(viaSession.id)).toEqual([null]);
  });

  it('права пространств владельца соблюдаются: pull не видит чужое', async () => {
    const w = await world(db);
    const mine = await owner();
    const { secret } = await issue(mine.cookie, 'read');
    const clientId = uuidv7();
    const b = (await req('GET', `/sync/bootstrap?clientId=${clientId}`, { bearer: secret })).json();
    expect(JSON.stringify(b)).not.toContain(w.spaceId);
    await w.admin.ok('task.create', taskArgs(w));
    const p = await req('GET', `/sync/pull?cursor=${b.cursor}&clientId=${clientId}`, {
      bearer: secret,
    });
    expect(JSON.stringify(p.json())).not.toContain(w.spaceId);
  });
});
