import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createApp } from '../../src/app.js';
import { pushSubscriptions } from '../../src/db/schema.js';
import { ORIGIN, createUser, loginCookie } from '../auth.js';
import { dbUrl, newDb } from '../sync/helpers.js';

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let noKey: Awaited<ReturnType<typeof createApp>>;

beforeAll(async () => {
  app = await createApp({
    databaseUrl: dbUrl,
    publicUrl: ORIGIN,
    push: { vapid: { publicKey: 'PUB', privateKey: 'PRIV' } },
  });
  noKey = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN });
  for (const a of [app, noKey]) {
    await a.init();
    await a.getHttpAdapter().getInstance().ready();
  }
});
afterAll(async () => {
  await app.close();
  await noKey.close();
  await db.$client.end();
});

const req = (
  a: typeof app,
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  cookie?: string,
  payload?: unknown,
) =>
  a
    .getHttpAdapter()
    .getInstance()
    .inject({
      method,
      url,
      headers: { ...(cookie && { cookie }), origin: ORIGIN },
      payload: payload as object,
    });

const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } });
const mk = async () => loginCookie(db, (await createUser(db)).id);
const owner = async (endpoint: string) =>
  (await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)))[0]
    ?.userId;

describe('/api/push', () => {
  it('vapid: ключ есть → 200, нет → 404 not_found; без входа 401', async () => {
    const c = await mk();
    const ok = await req(app, 'GET', '/api/push/vapid', c);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ publicKey: 'PUB' });
    const no = await req(noKey, 'GET', '/api/push/vapid', c);
    expect(no.statusCode).toBe(404);
    expect(no.json().code).toBe('not_found');
    expect((await req(app, 'GET', '/api/push/vapid')).statusCode).toBe(401);
  });

  it('subscribe: 201, повтор — 200 (обновление), неверное тело — 400', async () => {
    const c = await mk();
    const url = 'https://push.example/' + Math.random();
    expect((await req(app, 'POST', '/api/push/subscribe', c, sub(url))).statusCode).toBe(201);
    const again = await req(app, 'POST', '/api/push/subscribe', c, {
      endpoint: url,
      keys: { p256dh: 'new', auth: 'a' },
    });
    expect(again.statusCode).toBe(200);
    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, url));
    expect(rows).toHaveLength(1);
    expect(rows[0].p256dh).toBe('new');
    expect((await req(app, 'POST', '/api/push/subscribe', c, { endpoint: 'x' })).statusCode).toBe(
      400,
    );
  });

  it('unsubscribe: чужую не удалить, свою — 204', async () => {
    const a = await mk();
    const b = await mk();
    const url = 'https://push.example/' + Math.random();
    await req(app, 'POST', '/api/push/subscribe', a, sub(url));
    const uid = await owner(url);
    expect((await req(app, 'DELETE', '/api/push/subscribe', b, { endpoint: url })).statusCode).toBe(
      204,
    );
    expect(await owner(url)).toBe(uid);
    expect((await req(app, 'DELETE', '/api/push/subscribe', a, { endpoint: url })).statusCode).toBe(
      204,
    );
    expect(await owner(url)).toBeUndefined();
  });
});
