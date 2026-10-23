import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { createApp } from '../../src/app.js';
import { ORIGIN, loginCookie } from '../auth.js';
import { testDbUrl } from '../db.js';
import { mkUser, newDb, TestClient, services, world, type World } from '../sync/helpers.js';

const db = newDb();
let app: Awaited<ReturnType<typeof createApp>>;
let w: World;
let cookie: string;
const get = (url: string) =>
  app.getHttpAdapter().getInstance().inject({ method: 'GET', url, headers: { cookie } });
const setModules = (c: TestClient, value: unknown) =>
  c.push('settings.set', { id: 'enabled_modules', value });
const note = (spaceId: string) => ({ id: uuidv7(), spaceId, text: 'hi' });

beforeAll(async () => {
  app = await createApp({ databaseUrl: testDbUrl(), publicUrl: ORIGIN });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  w = await world(db);
  cookie = await loginCookie(db, w.admin.userId);
  // admin мира — member; для settings нужен instance admin
});
afterAll(async () => {
  await app.close();
  await db.$client.end();
});

describe('модули', () => {
  let ia: TestClient; // instance admin
  beforeAll(async () => {
    ia = new TestClient(services(db), await mkUser(db, 'admin'));
  });

  it('выключен по умолчанию: ping 404 module_disabled', async () => {
    const r = await get('/api/hello/ping');
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe('module_disabled');
  });

  it('выключен: hello.create → unknown_mutator', async () => {
    expect(await w.admin.push('hello.create', note(w.spaceId))).toMatchObject({
      ok: false,
      code: 'unknown_mutator',
    });
  });

  it('выключен: bootstrap без helloNotes', async () => {
    expect((await w.admin.bootstrap()).data).not.toHaveProperty('helloNotes');
  });

  it('GET /api/modules: hello выключен', async () => {
    const r = await get('/api/modules');
    expect(r.json()).toEqual({ modules: [{ id: 'hello', enabled: false }] });
  });

  it('GET /api/modules без входа → 401', async () => {
    const r = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/api/modules' });
    expect(r.statusCode).toBe(401);
  });

  it('settings.set не-админом → forbidden', async () => {
    expect(await setModules(w.admin, ['hello'])).toMatchObject({ ok: false, code: 'forbidden' });
  });

  it('включение без перезапуска: ping, мутатор, bootstrap, pull, reset другим', async () => {
    const { cursor } = await w.member.bootstrap();
    await ia.ok('settings.set', { id: 'enabled_modules', value: ['hello'] });

    expect((await get('/api/hello/ping')).json()).toEqual({ ok: true });
    expect((await get('/api/modules')).json()).toEqual({
      modules: [{ id: 'hello', enabled: true }],
    });

    const n = note(w.spaceId);
    await w.admin.ok('hello.create', n);
    expect((await w.admin.bootstrap()).data.helloNotes).toMatchObject([
      { id: n.id, text: 'hi', spaceId: w.spaceId },
    ]);
    // другой клиент: смена enabled_modules → reset
    expect(await w.member.pull(cursor)).toMatchObject({ reset: true });
    const { cursor: c2 } = await w.member.bootstrap();
    expect((await w.member.bootstrap()).data.helloNotes).toHaveLength(1);

    // pull отдаёт строки модуля
    const n2 = note(w.spaceId);
    await w.admin.ok('hello.create', n2);
    const p = await w.member.pull(c2);
    expect(p.changes).toMatchObject([{ entity: 'helloNotes', id: n2.id, op: 'put' }]);
  });

  it('мутатор модуля уважает права сущности (guest → forbidden, чужой → forbidden)', async () => {
    expect(await w.guest.push('hello.create', note(w.spaceId))).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    expect(await w.outsider.push('hello.create', note(w.spaceId))).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
  });

  it('строки модуля видны только участникам пространства', async () => {
    expect((await w.outsider.bootstrap()).data.helloNotes ?? []).toEqual([]);
  });

  it('выключение: снова скрыто, pull не отдаёт строк helloNotes', async () => {
    const { cursor } = await w.member.bootstrap();
    await w.admin.ok('hello.create', note(w.spaceId));
    await ia.ok('settings.set', { id: 'enabled_modules', value: [] });

    expect((await get('/api/hello/ping')).statusCode).toBe(404);
    expect(await w.admin.push('hello.create', note(w.spaceId))).toMatchObject({
      code: 'unknown_mutator',
    });
    expect((await w.admin.bootstrap()).data).not.toHaveProperty('helloNotes');
    // reset ведёт к bootstrap; а pull с курсором после reset не содержит helloNotes
    expect(await w.member.pull(cursor)).toMatchObject({ reset: true, changes: [] });
    const { cursor: c2 } = await w.member.bootstrap();
    await ia.ok('settings.set', { id: 'other', value: 1 });
    expect((await w.member.pull(c2)).changes.map((c) => c.entity)).not.toContain('helloNotes');
  });

  it('данные сохраняются при выключении и возвращаются при включении', async () => {
    await ia.ok('settings.set', { id: 'enabled_modules', value: ['hello'] });
    expect((await w.admin.bootstrap()).data.helloNotes!.length).toBeGreaterThanOrEqual(2);
  });

  it('неизвестный id и мусор в enabled_modules игнорируются', async () => {
    await ia.ok('settings.set', { id: 'enabled_modules', value: ['nope', 5] });
    expect((await get('/api/modules')).json().modules[0].enabled).toBe(false);
    await ia.ok('settings.set', { id: 'enabled_modules', value: 'hello' });
    expect((await get('/api/hello/ping')).statusCode).toBe(404);
  });
});
