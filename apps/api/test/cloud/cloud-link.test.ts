import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { notifications } from '../../src/db/schema.js';
import { createUser, loginCookie } from '../auth.js';
import { db, req, useApp } from '../auth/harness.js';

// fake cloud-app: GET /api/link/state, POST /api/link/domain (docs/contracts/cloud-link.md)
const DAY = 86400_000;
let state: Record<string, unknown> = {};
const seen: { url?: string; auth?: string; body?: string }[] = [];
const setState = (status: string, trialDays: number) =>
  (state = {
    status,
    trialEndsAt: new Date(Date.now() + trialDays * DAY).toISOString(),
    deleteAfter: null,
    domain: 'acme.planar.test',
    customDomain: null,
    serverIp: '203.0.113.5',
    checkout: { paddle: 'https://pay.test/acme' },
    manageUrl: null,
  });
const cloud = createServer((rq, rs) => {
  let body = '';
  rq.on('data', (c) => (body += c));
  rq.on('end', () => {
    seen.push({ url: rq.url, auth: rq.headers.authorization, body });
    if (rq.headers.authorization !== 'Bearer tok') return void rs.writeHead(401).end();
    if (rq.url === '/api/link/export') {
      rs.writeHead(200, { 'content-type': 'application/json' });
      return void rs.end(JSON.stringify({ path: '/api/export/ab.cd' }));
    }
    if (rq.url === '/api/link/reset') {
      rs.writeHead(200, { 'content-type': 'application/json' });
      return void rs.end(JSON.stringify({ ticket: 'tk-1' }));
    }
    if (rq.url === '/api/link/domain') {
      rs.writeHead(422, { 'content-type': 'application/json' });
      return void rs.end(JSON.stringify({ statusMessage: 'dns_missing', data: '203.0.113.5' }));
    }
    rs.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(state));
  });
});
await new Promise<void>((r) => cloud.listen(0, '127.0.0.1', r));
afterAll(() => cloud.close());
setState('trial', 60);

const cloudUrl = `http://127.0.0.1:${(cloud.address() as AddressInfo).port}`;
useApp({ appOpts: { cloud: { url: cloudUrl, token: 'tok' } } });

const LOGIN_TOKEN = 'L'.repeat(43);
let owner = '';

describe('cloud-link', () => {
  it('setup с loginToken → одноразовый вход через /api/auth/handoff', async () => {
    const r = await req('POST', '/api/setup', {
      body: {
        login: 'admin',
        name: 'Admin',
        password: 'password1',
        email: 'a@b.co',
        loginToken: LOGIN_TOKEN,
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().user.email).toBe('a@b.co');
    const h = await req('GET', `/api/auth/handoff?token=${LOGIN_TOKEN}`);
    expect([h.statusCode, h.headers.location]).toEqual([302, '/']);
    owner = String(h.headers['set-cookie']).split(';')[0]!;
    expect((await req('GET', '/api/auth/me', { cookie: owner })).json().user.login).toBe('admin');
    const again = await req('GET', `/api/auth/handoff?token=${LOGIN_TOKEN}`);
    expect([again.statusCode, again.headers.location, again.headers['set-cookie']]).toEqual([
      302,
      '/login',
      undefined,
    ]);
  });

  it('GET /api/cloud — состояние из облака по Bearer; ≤ 30 дней — одно уведомление админам и статус в /api/setup', async () => {
    const r = await req('GET', '/api/cloud', { cookie: owner });
    expect(r.json()).toMatchObject({ status: 'trial', domain: 'acme.planar.test' });
    expect(seen.at(-1)).toMatchObject({ url: '/api/link/state', auth: 'Bearer tok' });
    const member = await createUser(db);
    expect(
      (await req('GET', '/api/cloud', { cookie: await loginCookie(db, member.id) })).statusCode,
    ).toBe(403);
    const kinds = async () =>
      (await db.select().from(notifications).where(eq(notifications.kind, 'trial_ending'))).length;
    expect(await kinds()).toBe(0);

    setState('trial', 10);
    await req('GET', '/api/cloud', { cookie: owner });
    await req('GET', '/api/cloud', { cookie: owner });
    expect(await kinds()).toBe(1); // только владелец; повторное обновление не дублирует
    expect((await req('GET', '/api/setup')).json().cloud).toEqual({
      status: 'trial',
      trialEndsAt: state.trialEndsAt,
      expired: false,
    });
  });

  it('ошибка облака приходит кодом в details.cloud', async () => {
    const r = await req('POST', '/api/cloud/domain', {
      cookie: owner,
      body: { host: 'x.example.com' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().details).toEqual({ cloud: 'dns_missing', data: '203.0.113.5' });
    expect(JSON.parse(seen.at(-1)!.body!)).toEqual({ host: 'x.example.com' });
  });

  it('handoff для админа облака: только с CLOUD_TOKEN, токен входит владельцем', async () => {
    expect((await req('POST', '/api/cloud/handoff', { origin: null })).statusCode).toBe(401);
    const bad = { origin: null, headers: { authorization: 'Bearer nope' } };
    expect((await req('POST', '/api/cloud/handoff', bad)).statusCode).toBe(401);
    const r = await req('POST', '/api/cloud/handoff', {
      origin: null,
      headers: { authorization: 'Bearer tok' },
    });
    expect(r.statusCode).toBe(200);
    const h = await req('GET', `/api/auth/handoff?token=${r.json().token}`);
    expect(h.headers.location).toBe('/');
    const cookie = String(h.headers['set-cookie']).split(';')[0]!;
    expect((await req('GET', '/api/auth/me', { cookie })).json().user.login).toBe('admin');
  });

  it('выгрузка: только владелец; url — скачивание из облака', async () => {
    const admin = await createUser(db, { role: 'admin' });
    const cookie = await loginCookie(db, admin.id);
    expect((await req('POST', '/api/cloud/export', { cookie })).statusCode).toBe(403);
    const r = await req('POST', '/api/cloud/export', { cookie: owner });
    expect(r.json()).toEqual({ url: `${cloudUrl}/api/export/ab.cd` });
  });

  it('очистка: только владелец; url — страница ожидания облака', async () => {
    const admin = await createUser(db, { role: 'admin' });
    const body = { confirm: 'acme', password: 'new-pass-1' };
    const cookie = await loginCookie(db, admin.id);
    expect((await req('POST', '/api/cloud/reset', { cookie, body })).statusCode).toBe(403);
    const r = await req('POST', '/api/cloud/reset', { cookie: owner, body });
    expect(r.json()).toEqual({ url: `${cloudUrl}/reset/tk-1` });
    expect(JSON.parse(seen.at(-1)!.body!)).toEqual(body);
  });

  it('триал истёк: обычным — вход закрыт; админу — только auth и cloud', async () => {
    const member = await createUser(db, { login: 'worker' });
    const memberCookie = await loginCookie(db, member.id);
    setState('expired', -1);
    await req('GET', '/api/cloud', { cookie: owner });
    expect((await req('GET', '/api/setup')).json().cloud.expired).toBe(true);
    expect((await req('GET', '/api/auth/me', { cookie: memberCookie })).statusCode).toBe(401);
    expect((await req('GET', '/api/auth/me', { cookie: owner })).statusCode).toBe(200);
    const blocked = await req('GET', '/api/users', { cookie: owner });
    expect([blocked.statusCode, blocked.json().details]).toEqual([403, { cloud: 'trial_expired' }]);
    expect((await req('GET', '/api/cloud', { cookie: owner })).statusCode).toBe(200);
    // оплата в облаке → инстанс снова открыт
    setState('active', -1);
    await req('GET', '/api/cloud', { cookie: owner });
    expect((await req('GET', '/api/users', { cookie: owner })).statusCode).toBe(200);
    expect((await req('GET', '/api/auth/me', { cookie: memberCookie })).statusCode).toBe(200);
  });
});
