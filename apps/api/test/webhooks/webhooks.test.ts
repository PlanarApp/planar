import { createHmac, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { api as webhooks, enqueueWebhookEvent } from '@planar/module-webhooks/api';
import { webhooksDeliveries as D } from '@planar/module-webhooks/api/schema';
import { settings } from '../../src/db/schema.js';
import { createUser, loginCookie, ORIGIN } from '../auth.js';
import { db, getApp, useApp } from '../auth/harness.js';
import { doc, world, type World } from '../sync/helpers.js';
// module internals: signature, address checks, delivery attempt
import { attempt, retryDelaySec } from '../../../../modules/webhooks/api/deliver.js';
import { sign } from '../../../../modules/webhooks/api/send.js';
import { BlockedAddress, isBlocked, safeAddress } from '../../../../modules/webhooks/api/ssrf.js';

useApp();

let w: World;
let cookie: string;
let recv: http.Server;
let hits: { url: string; headers: http.IncomingHttpHeaders; body: string }[] = [];
let reply: (res: http.ServerResponse) => void = (res) => res.writeHead(200).end('ok');
let base: string;

beforeAll(async () => {
  w = await world(db);
  await db
    .insert(settings)
    .values({ id: 'enabled_modules', value: ['webhooks'] })
    .onConflictDoUpdate({ target: settings.id, set: { value: ['webhooks'] } });
  cookie = await loginCookie(db, (await createUser(db, { role: 'admin' })).id);
  recv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      hits.push({ url: req.url!, headers: req.headers, body });
      reply(res);
    });
  });
  await new Promise<void>((r) => recv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(recv.address() as AddressInfo).port}`;
});
afterAll(() => void recv.close());
beforeEach(() => {
  hits = [];
  reply = (res) => res.writeHead(200).end('ok');
  process.env.WEBHOOKS_ALLOW_HOSTS = '127.0.0.1';
});
afterEach(() => {
  delete process.env.WEBHOOKS_TIMEOUT_MS;
});

const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  getApp()
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: method as 'GET',
      url: `/api/webhooks/${url}`,
      payload: body as object | undefined,
      headers: { cookie, origin: ORIGIN, ...headers },
    });
const mkSub = async (o: Record<string, unknown> = {}) => {
  const r = await call('POST', 'subscriptions', { url: `${base}/hook`, events: ['ping'], ...o });
  expect(r.statusCode).toBe(201);
  return { ...r.json().data, secret: r.json().secret } as { id: string; secret: string };
};
const ping = async (id: string) =>
  (await call('POST', `subscriptions/${id}/ping`)).json().data as { id: string };
const enq: { queue: string; data: object; opts?: { startAfter?: number } }[] = [];
const jobApi = {
  get db() {
    return db;
  },
  enqueue: async (queue: string, data: object, opts?: { startAfter?: number }) =>
    void enq.push({ queue, data, opts }),
} as never;
const row = async (id: string) => (await db.select().from(D).where(eq(D.id, id)))[0]!;
const run = async (id: string) => {
  // preparation for an attempt: the time has come
  await db
    .update(D)
    .set({ nextAttemptAt: new Date(Date.now() - 1000).toISOString() })
    .where(eq(D.id, id));
  await attempt(id, jobApi);
  return row(id);
};
const deliveriesOf = (subId: string) => db.select().from(D).where(eq(D.subscriptionId, subId));
const taskOf = (over: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  projectId: w.projectId,
  statusId: w.statusIds[1],
  title: 'T',
  rank: 'a0',
  ...over,
});

describe('wk4: подпись и заголовки', () => {
  it('wk4: подпись равна эталону контракта', () => {
    const c = {
      secret: 'whsec_test',
      body: '{"id":"0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6c01","event":"ping","createdAt":"2026-10-23T06:00:00.000Z","data":{}}',
      signature: 'sha256=a43c17381401da94222350b1503b6bcef9ff6ef41b99d0b29a8df25c68b0dac1',
    };
    expect(sign(c.secret, c.body)).toBe(c.signature);
  });

  it('wk4: доставка: заголовки, подпись проверяется эталонным способом, 2xx → ok', async () => {
    const s = await mkSub();
    const d = await ping(s.id);
    const after = await run(d.id);
    expect(after).toMatchObject({
      status: 'ok',
      attempts: 1,
      lastStatus: 200,
      nextAttemptAt: null,
    });
    const h = hits[0]!;
    expect(h.headers['x-planar-event']).toBe('ping');
    expect(h.headers['x-planar-delivery']).toBe(d.id);
    expect(h.headers['user-agent']).toBe('Planar-Webhooks/1');
    expect(h.headers['content-type']).toBe('application/json');
    const expected = 'sha256=' + createHmac('sha256', s.secret).update(h.body).digest('hex');
    const got = String(h.headers['x-planar-signature']);
    expect(
      got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected)),
    ).toBe(true);
    expect(JSON.parse(h.body)).toMatchObject({ id: d.id, event: 'ping', data: {} });
  });

  it('wk4: rotate-secret меняет подпись', async () => {
    const s = await mkSub();
    const { secret } = (await call('POST', `subscriptions/${s.id}/rotate-secret`)).json();
    expect(secret).toMatch(/^whsec_[0-9A-Za-z]{43}$/);
    expect(secret).not.toBe(s.secret);
    await run((await ping(s.id)).id);
    expect(hits[0]!.headers['x-planar-signature']).toBe(sign(secret, hits[0]!.body));
  });
});

describe('wk4: SSRF', () => {
  it('wk4: приёмник на 127.0.0.1 без allowlist → failed blocked_address без повторов', async () => {
    delete process.env.WEBHOOKS_ALLOW_HOSTS;
    enq.length = 0;
    const d = await run((await ping((await mkSub()).id)).id);
    expect(d).toMatchObject({ status: 'failed', lastError: 'blocked_address', attempts: 1 });
    expect(d.nextAttemptAt).toBeNull();
    expect(hits).toHaveLength(0);
    expect(enq).toHaveLength(0);
  });

  it('wk4: запрещённые адреса', () => {
    for (const a of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.169.254',
      '::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '0.0.0.0',
      '100.64.0.1',
      '172.16.5.5',
      '192.168.1.1',
      '224.0.0.1',
      '255.255.255.255',
      'fe80::1',
      'fc00::1',
      'ff02::1',
      '::',
    ])
      expect(isBlocked(a), a).toBe(true);
    for (const a of ['8.8.8.8', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])
      expect(isBlocked(a), a).toBe(false);
  });

  it('wk4: IP-литерал, localhost и IPv6-литерал отклоняются после резолва', async () => {
    delete process.env.WEBHOOKS_ALLOW_HOSTS;
    for (const h of ['127.0.0.1', 'localhost', '[::1]', '[::ffff:127.0.0.1]'])
      await expect(safeAddress(h), h).rejects.toBeInstanceOf(BlockedAddress);
  });

  it('wk4: WEBHOOKS_ALLOW_HOSTS принимает имена и CIDR', async () => {
    process.env.WEBHOOKS_ALLOW_HOSTS = 'localhost';
    await expect(safeAddress('localhost')).resolves.toBeDefined();
    process.env.WEBHOOKS_ALLOW_HOSTS = '10.0.0.0/8, 127.0.0.0/8';
    await expect(safeAddress('127.0.0.1')).resolves.toBeDefined();
    await expect(safeAddress('192.168.0.1')).rejects.toBeInstanceOf(BlockedAddress);
  });

  it('wk4: ftp:// и userinfo при создании → 400', async () => {
    for (const url of [
      'ftp://example.com/x',
      'http://user:pw@example.com/',
      'не url',
      `http://example.com/${'a'.repeat(2000)}`,
    ])
      expect((await call('POST', 'subscriptions', { url, events: ['ping'] })).statusCode, url).toBe(
        400,
      );
    expect((await call('POST', 'subscriptions', { url: base, events: [] })).statusCode).toBe(400);
  });
});

describe('wk4: попытки и повторы', () => {
  it('wk4: редирект 302 — неудача, Location не запрашивается', async () => {
    reply = (res) => res.writeHead(302, { Location: `${base}/next` }).end();
    const d = await run((await ping((await mkSub()).id)).id);
    expect(d).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastStatus: 302,
      lastError: 'redirect',
    });
    expect(hits.map((h) => h.url)).toEqual(['/hook']);
  });

  it('wk4: таймаут → неудача с повтором', async () => {
    process.env.WEBHOOKS_TIMEOUT_MS = '200';
    const sockets = new Set<import('node:net').Socket>();
    recv.on('connection', (s) => sockets.add(s));
    reply = () => {}; // does not respond
    const d = await run((await ping((await mkSub()).id)).id);
    expect(d).toMatchObject({ status: 'pending', attempts: 1, lastError: 'timeout' });
    sockets.forEach((s) => s.destroy());
  });

  it('wk4: график повторов 60,120,240… с, после 11-й попытки — failed', async () => {
    reply = (res) => res.writeHead(500).end();
    enq.length = 0;
    const id = (await ping((await mkSub()).id)).id;
    for (let n = 1; n <= 10; n++) {
      const t0 = Date.now();
      const d = await run(id);
      const delay = 60 * 2 ** (n - 1);
      expect(d).toMatchObject({ status: 'pending', attempts: n, lastStatus: 500 });
      expect(enq.at(-1)).toMatchObject({
        queue: 'webhooks.deliver',
        data: { deliveryId: id },
        opts: { startAfter: delay },
      });
      expect(retryDelaySec(n)).toBe(delay);
      expect(Date.parse(d.nextAttemptAt!) - t0).toBeGreaterThanOrEqual(delay * 1000 - 50);
      expect(Date.parse(d.nextAttemptAt!) - t0).toBeLessThan(delay * 1000 + 5000);
    }
    expect(await run(id)).toMatchObject({ status: 'failed', attempts: 11, nextAttemptAt: null });
    expect(enq).toHaveLength(10);
    expect(await run(id)).toMatchObject({ attempts: 11 }); // a completed one is not retried
  });

  it('wk4: повторная параллельная задача не дублирует отправку (аренда)', async () => {
    const id = (await ping((await mkSub()).id)).id;
    await db
      .update(D)
      .set({ nextAttemptAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(D.id, id));
    await Promise.all([attempt(id, jobApi), attempt(id, jobApi)]);
    expect(hits).toHaveLength(1);
  });

  it('wk4: ручной повтор создаёт новую доставку с тем же payload', async () => {
    const s = await mkSub();
    const d = await run((await ping(s.id)).id);
    const r = await call('POST', `deliveries/${d.id}/redeliver`);
    expect(r.statusCode).toBe(202);
    const n = r.json().data;
    expect(n.id).not.toBe(d.id);
    expect(n).toMatchObject({
      event: 'ping',
      payload: {},
      status: 'pending',
      subscriptionId: s.id,
    });
    expect((await deliveriesOf(s.id)).length).toBe(2);
    expect((await call('POST', `deliveries/${uuidv7()}/redeliver`)).statusCode).toBe(404);
  });
});

describe('wk4: REST и права', () => {
  it('wk4: не-админ → 403, без входа → 401, Bearer → 403', async () => {
    const m = await loginCookie(db, (await createUser(db, { role: 'member' })).id);
    expect((await call('GET', 'subscriptions', undefined, { cookie: m })).statusCode).toBe(403);
    expect((await call('GET', 'subscriptions', undefined, { cookie: '' })).statusCode).toBe(401);
    const tok = await getApp()
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/api/tokens',
        payload: { name: 't', scope: 'write' },
        headers: { cookie, origin: ORIGIN },
      });
    const r = await call('GET', 'subscriptions', undefined, {
      cookie: '',
      authorization: `Bearer ${tok.json().secret}`,
    });
    expect(r.statusCode).toBe(403);
  });

  it('wk4: список без secret; patch, delete каскадом, пагинация журнала', async () => {
    const s = await mkSub({ description: 'd' });
    const list = (await call('GET', 'subscriptions')).json().data as Record<string, unknown>[];
    expect(list.find((x) => x.id === s.id)).toMatchObject({ description: 'd', active: true });
    expect(JSON.stringify(list)).not.toContain('secret');
    const p = await call('PATCH', `subscriptions/${s.id}`, {
      active: false,
      events: ['task.created'],
    });
    expect(p.json().data).toMatchObject({ active: false, events: ['task.created'] });
    for (let i = 0; i < 3; i++) await ping(s.id);
    const p1 = (await call('GET', `subscriptions/${s.id}/deliveries?limit=2`)).json();
    expect(p1.data).toHaveLength(2);
    const p2 = (
      await call('GET', `subscriptions/${s.id}/deliveries?limit=2&cursor=${p1.nextCursor}`)
    ).json();
    expect(p2.data).toHaveLength(1);
    expect(p2.nextCursor).toBeNull();
    expect(p2.data[0].id).not.toBe(p1.data[0].id);
    expect((await call('DELETE', `subscriptions/${s.id}`)).statusCode).toBe(204);
    expect(await deliveriesOf(s.id)).toHaveLength(0);
    expect((await call('DELETE', `subscriptions/${s.id}`)).statusCode).toBe(404);
  });
});

describe('wk4: события из хука', () => {
  const evs = async (subId: string) =>
    (await deliveriesOf(subId)).map((d) => ({
      event: d.event,
      payload: d.payload as Record<string, ReturnType<typeof JSON.parse>>,
    }));

  it('wk4: task.create/update/assign/delete и comment.create → по одной доставке', async () => {
    const s = await mkSub({
      events: ['task.created', 'task.updated', 'task.deleted', 'comment.created'],
    });
    const t = taskOf();
    await w.admin.ok('task.create', t);
    await w.admin.ok('task.update', { id: t.id, title: 'new' });
    await w.admin.ok('task.assign', { id: uuidv7(), taskId: t.id, userId: w.member.userId });
    await w.admin.ok('comment.create', { id: uuidv7(), taskId: t.id, body: doc('привет') });
    await w.admin.ok('task.delete', { id: t.id });
    const all = await evs(s.id);
    expect(all.map((e) => e.event).sort()).toEqual([
      'comment.created',
      'task.created',
      'task.deleted',
      'task.updated',
      'task.updated',
    ]);
    const created = all.find((e) => e.event === 'task.created')!.payload;
    expect(created).toMatchObject({
      changes: {},
      actorId: w.admin.userId,
      task: { id: t.id, assigneeIds: [] },
    });
    expect(created.task.key).toMatch(/-1$/);
    const upd = all.filter((e) => e.event === 'task.updated').map((e) => e.payload);
    expect(upd.find((u) => u.changes.title)!.changes).toEqual({ title: ['T', 'new'] });
    expect(upd.find((u) => u.changes.assigneeIds)!.changes.assigneeIds).toEqual([
      [],
      [w.member.userId],
    ]);
    expect(all.find((e) => e.event === 'comment.created')!.payload.comment).toMatchObject({
      taskId: t.id,
      text: 'привет',
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      authorId: w.admin.userId,
    });
    expect(all.find((e) => e.event === 'task.deleted')!.payload).toEqual({
      task: { id: t.id, key: created.task.key, projectId: w.projectId, spaceId: w.spaceId },
      actorId: w.admin.userId,
    });
  });

  it('wk4: выключенная подписка и событие не из списка — нет доставки', async () => {
    const off = await mkSub({ events: ['task.created'] });
    await call('PATCH', `subscriptions/${off.id}`, { active: false });
    const other = await mkSub({ events: ['task.deleted'] });
    await w.admin.ok('task.create', taskOf());
    expect(await deliveriesOf(off.id)).toHaveLength(0);
    expect(await deliveriesOf(other.id)).toHaveLength(0);
  });

  it('wk4: enqueueWebhookEvent (automations): активная подписка получает, выключенная — нет', async () => {
    expect((await call('POST', 'subscriptions', { url: base, events: [] })).statusCode).toBe(400);
    const a = await mkSub({ events: ['task.created'] });
    const b = await mkSub({ events: ['task.created'] });
    await call('PATCH', `subscriptions/${b.id}`, { active: false });
    enq.length = 0;
    for (const id of [a.id, b.id, uuidv7()])
      await enqueueWebhookEvent(jobApi, id, 'automation.fired', { ruleId: 'r', task: { id: 't' } });
    expect(await evs(a.id)).toEqual([
      { event: 'automation.fired', payload: { ruleId: 'r', task: { id: 't' } } },
    ]);
    expect(await deliveriesOf(b.id)).toHaveLength(0);
    expect(enq).toHaveLength(1);
    await run(enq[0]!.data['deliveryId' as never]);
    expect(JSON.parse(hits.at(-1)!.body)).toMatchObject({
      event: 'automation.fired',
      data: { ruleId: 'r' },
    });
  });

  it('wk4: манифест: задачи deliver и sweep, afterMutation', () => {
    expect((webhooks.jobs as { queue: string }[]).map((j) => j.queue)).toEqual([
      'webhooks.deliver',
      'webhooks.sweep',
    ]);
    expect(webhooks.afterMutation).toBeTypeOf('function');
  });
});
