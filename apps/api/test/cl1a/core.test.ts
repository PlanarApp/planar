import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import WebSocket from 'ws';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { defineMutator, uuidv7, type EntityMeta } from '@planar/shared';
import * as schema from '../../src/db/schema.js';
import type { TestClient as TC } from '../sync/helpers.js';

// Фикстура модуля с space|members: подмена installed до загрузки реестра сущностей.
const { installed } = await import('../../src/modules/installed.js');
@Module({})
class FixtureModule {}

const ts = () => timestamp({ withTimezone: true, mode: 'string' });
const cltBoxes = pgTable('clt_boxes', {
  id: uuid().primaryKey(),
  spaceId: uuid(),
  name: text().notNull(),
  createdBy: uuid().notNull(),
  createdAt: ts().notNull(),
});
const cltMembers = pgTable('clt_members', {
  id: uuid().primaryKey(),
  boxId: uuid().notNull(),
  userId: uuid().notNull(),
  createdAt: ts().notNull(),
});
const cltItems = pgTable('clt_items', {
  id: uuid().primaryKey(),
  spaceId: uuid(),
  boxId: uuid().notNull(),
  text: text().notNull(),
  createdAt: ts().notNull(),
});
const members = { entity: 'cltMembers', key: 'boxId', container: 'cltBoxes' };
const meta = (via: string, bootstrap: boolean): EntityMeta => ({
  scope: 'space|members',
  write: 'member',
  bootstrap,
  indexes: [],
  members: { ...members, via },
});
const D = z.iso.datetime();
const entities = {
  cltBoxes: {
    schema: z.object({
      id: z.uuid(),
      spaceId: z.uuid().nullable(),
      name: z.string(),
      createdBy: z.uuid(),
      createdAt: D,
    }),
    meta: meta('id', true),
  },
  cltMembers: {
    schema: z.object({ id: z.uuid(), boxId: z.uuid(), userId: z.uuid(), createdAt: D }),
    meta: meta('boxId', true),
  },
  cltItems: {
    schema: z.object({
      id: z.uuid(),
      spaceId: z.uuid().nullable(),
      boxId: z.uuid(),
      text: z.string(),
      createdAt: D,
    }),
    meta: meta('boxId', false),
  },
};
type Tx = { put(e: string, r: unknown): Promise<void>; del(e: string, id: string): Promise<void> };
installed.push({
  api: {
    id: 'clt',
    nestModule: FixtureModule,
    entities,
    mutators: [
      defineMutator({
        name: 'clt.put',
        args: z.object({ entity: z.string(), row: z.record(z.string(), z.unknown()) }),
        run: (tx, a) => (tx as unknown as Tx).put(a.entity, a.row),
      }),
      defineMutator({
        name: 'clt.del',
        args: z.object({ entity: z.string(), id: z.uuid() }),
        run: (tx, a) => (tx as unknown as Tx).del(a.entity, a.id),
      }),
    ],
  },
  tables: { cltBoxes, cltMembers, cltItems },
});

const { ORIGIN, loginCookie } = await import('../auth.js');
const { dbUrl, mkSpace, mkUser, newDb, services, TestClient } = await import('../sync/helpers.js');
const { createApp } = await import('../../src/app.js');
const { PushQueue } = await import('../../src/push/push.js');
const { api: docsApi } = await import('@planar/module-docs/api');

const db = newDb();
const dataDir = mkdtempSync(join(tmpdir(), 'planar-cl1a-'));
let app: Awaited<ReturnType<typeof createApp>>;
let wsUrl: string;
const sockets: WebSocket[] = [];
const now = () => new Date().toISOString();
let a: TC, b: TC, c: TC;
let cookies: Record<string, string>;

beforeAll(async () => {
  await db.execute(sql`
    create table clt_boxes (id uuid primary key, space_id uuid, name text not null,
      created_by uuid not null, created_at timestamptz not null);
    create table clt_members (id uuid primary key, box_id uuid not null, user_id uuid not null,
      created_at timestamptz not null);
    create table clt_items (id uuid primary key, space_id uuid, box_id uuid not null,
      text text not null, created_at timestamptz not null)`);
  await db
    .insert(schema.settings)
    .values({ id: 'enabled_modules', value: ['clt', 'docs'] })
    .onConflictDoUpdate({ target: schema.settings.id, set: { value: ['clt', 'docs'] } });
  const s = services(db);
  [a, b, c] = await Promise.all(
    [0, 1, 2].map(async () => new TestClient(s, await mkUser(db, 'member'))),
  );
  cookies = {
    a: await loginCookie(db, a.userId),
    b: await loginCookie(db, b.userId),
    c: await loginCookie(db, c.userId),
  };
  app = await createApp({ databaseUrl: dbUrl, publicUrl: ORIGIN, dataDir });
  await app.listen(0, '127.0.0.1');
  wsUrl = `ws://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/ws`;
});
afterAll(async () => {
  for (const s of sockets) s.terminate();
  await app.close();
  await db.$client.end();
});

type R = Record<string, unknown> & { id: string };
const put = (u: TC, entity: string, row: R) => u.push('clt.put', { entity, row });
const box = (createdBy: string, over: Partial<R> = {}) => ({
  id: uuidv7(),
  spaceId: null,
  name: 'box',
  createdBy,
  createdAt: now(),
  ...over,
});
const member = (boxId: string, userId: string) => ({
  id: uuidv7(),
  boxId,
  userId,
  createdAt: now(),
});
const item = (boxId: string, over: Partial<R> = {}) => ({
  id: uuidv7(),
  spaceId: null,
  boxId,
  text: 'hi',
  createdAt: now(),
  ...over,
});
/** Контейнер с участниками users (создаёт первый). */
async function mkBox(users: TC[]) {
  const bx = box(users[0]!.userId);
  await users[0]!.ok('clt.put', { entity: 'cltBoxes', row: bx });
  for (const u of users)
    await users[0]!.ok('clt.put', { entity: 'cltMembers', row: member(bx.id, u.userId) });
  return bx;
}
const ids = async (u: TC, e: string) =>
  (((await u.bootstrap()).data as Record<string, R[]>)[e] ?? []).map((r) => r.id);
const pulled = async (u: TC, cursor: number) => (await u.pull(cursor)).changes;
const cursor = async () => (await a.bootstrap()).cursor;
const changesOf = (entity: string, id: string) =>
  db
    .select()
    .from(schema.changes)
    .where(sql`${schema.changes.entity} = ${entity} and ${schema.changes.id} = ${id}`);

describe('cl1a: space|members', () => {
  it('cl1a: участник получает по одной строке changes, третий — ни одной (pull)', async () => {
    const bx = await mkBox([a, b]);
    const cur = await cursor();
    const it1 = item(bx.id);
    await a.ok('clt.put', { entity: 'cltItems', row: it1 });
    const rows = await changesOf('cltItems', it1.id);
    expect(rows.map((r) => r.userId).sort()).toEqual([a.userId, b.userId].sort());
    expect(rows.every((r) => r.spaceId === null)).toBe(true);
    expect((await pulled(b, cur)).map((x) => x.id)).toContain(it1.id);
    expect((await pulled(a, cur)).filter((x) => x.id === it1.id)).toHaveLength(1);
    const cp = await pulled(c, 0);
    expect(cp.some((x) => [bx.id, it1.id].includes(x.id))).toBe(false);
  });

  it('cl1a: bootstrap — контейнер и участники только участнику, без bootstrap:no строк', async () => {
    const bx = await mkBox([a, b]);
    const it1 = item(bx.id);
    await a.ok('clt.put', { entity: 'cltItems', row: it1 });
    for (const u of [a, b]) {
      expect(await ids(u, 'cltBoxes')).toContain(bx.id);
      expect(await ids(u, 'cltItems')).not.toContain(it1.id);
      expect((await ids(u, 'cltMembers')).length).toBeGreaterThanOrEqual(2);
    }
    expect(await ids(c, 'cltBoxes')).not.toContain(bx.id);
    const memIds = (await changesOf('cltBoxes', bx.id)).map((r) => r.userId);
    expect(memIds).not.toContain(c.userId);
    // чужие участники не просачиваются
    const cm = ((await c.bootstrap()).data as Record<string, R[]>).cltMembers ?? [];
    expect(cm.some((m) => m.boxId === bx.id)).toBe(false);
  });

  it('cl1a: добавленный участник получает контейнер и участников без _reset', async () => {
    const bx = await mkBox([a, b]);
    const it1 = item(bx.id);
    await a.ok('clt.put', { entity: 'cltItems', row: it1 });
    const cur = await cursor();
    await a.ok('clt.put', { entity: 'cltMembers', row: member(bx.id, c.userId) });
    const p = await c.pull(cur);
    expect(p.reset).toBeUndefined();
    const got = p.changes.map((x) => `${x.entity}:${x.op}`);
    expect(got).toContain('cltBoxes:put');
    expect(p.changes.filter((x) => x.entity === 'cltMembers')).toHaveLength(3);
    // история (bootstrap:no) не отдаётся
    expect(p.changes.some((x) => x.id === it1.id)).toBe(false);
    expect(await ids(c, 'cltBoxes')).toContain(bx.id);
    // новые сообщения доходят
    const it2 = item(bx.id);
    await a.ok('clt.put', { entity: 'cltItems', row: it2 });
    expect((await pulled(c, p.cursor)).map((x) => x.id)).toContain(it2.id);
  });

  it('cl1a: удалённый участник получает del и больше не получает новых строк', async () => {
    const bx = await mkBox([a, b, c]);
    const cm = await db.select().from(cltMembers).where(eq(cltMembers.boxId, bx.id));
    const row = cm.find((m) => m.userId === c.userId)!;
    const cur = await cursor();
    await a.ok('clt.del', { entity: 'cltMembers', id: row.id });
    const p = await c.pull(cur);
    expect(p.reset).toBeUndefined();
    expect(p.changes.filter((x) => x.op === 'del').map((x) => x.entity)).toEqual(
      expect.arrayContaining(['cltBoxes', 'cltMembers']),
    );
    expect(p.changes.some((x) => x.op === 'put')).toBe(false);
    const it1 = item(bx.id);
    await a.ok('clt.put', { entity: 'cltItems', row: it1 });
    expect((await pulled(c, p.cursor)).some((x) => x.id === it1.id)).toBe(false);
    expect(await ids(c, 'cltBoxes')).not.toContain(bx.id);
    expect((await pulled(b, p.cursor)).map((x) => x.id)).toContain(it1.id);
  });

  it('cl1a: не участник не пишет (forbidden), создатель нового контейнера пишет', async () => {
    const bx = await mkBox([a, b]);
    expect(await put(c, 'cltItems', item(bx.id))).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await put(c, 'cltMembers', member(bx.id, c.userId))).toMatchObject({
      ok: false,
      code: 'forbidden',
    });
    expect(await put(c, 'cltBoxes', { ...bx, name: 'hijack' })).toMatchObject({
      code: 'forbidden',
    });
    // создатель нового контейнера (участников ещё нет)
    expect(await put(c, 'cltBoxes', box(c.userId))).toMatchObject({ ok: true });
    // чужой createdBy в новом контейнере — нельзя
    expect(await put(c, 'cltBoxes', box(a.userId))).toMatchObject({ code: 'forbidden' });
    // участник пишет
    expect(await put(b, 'cltItems', item(bx.id))).toMatchObject({ ok: true });
  });

  it('cl1a: строки со spaceId — по правилам space', async () => {
    const space = await mkSpace(db, a.userId, { [a.userId]: 'admin', [b.userId]: 'member' });
    const bx = box(a.userId, { spaceId: space });
    await a.ok('clt.put', { entity: 'cltBoxes', row: bx });
    expect(await put(c, 'cltItems', item(bx.id, { spaceId: space }))).toMatchObject({
      code: 'forbidden',
    });
    const it1 = item(bx.id, { spaceId: space });
    await b.ok('clt.put', { entity: 'cltItems', row: it1 });
    const rows = await changesOf('cltItems', it1.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ spaceId: space, userId: null });
    expect(await ids(b, 'cltBoxes')).toContain(bx.id);
    expect(await ids(c, 'cltBoxes')).not.toContain(bx.id);
  });
});

describe('cl1a: WS typing', () => {
  function connect(cookie: string) {
    const ws = new WebSocket(wsUrl, { headers: { cookie, origin: ORIGIN } });
    sockets.push(ws);
    const msgs: Record<string, unknown>[] = [];
    ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
    return new Promise<{ ws: WebSocket; msgs: typeof msgs }>((res, rej) => {
      ws.on('open', () => res({ ws, msgs }));
      ws.on('error', rej);
    });
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const typing = (m: { ws: WebSocket }, entity: string, id: string) =>
    m.ws.send(JSON.stringify({ t: 'typing', entity, id }));
  const typed = (m: { msgs: Record<string, unknown>[] }) => m.msgs.filter((x) => x.t === 'typing');

  it('cl1a: typing получает участник, не отправитель и не третий; троттлинг 3 с', async () => {
    const bx = await mkBox([a, b]);
    const [ca, cb, cc] = await Promise.all(
      [a, b, c].map((u) => connect(cookies[u === a ? 'a' : u === b ? 'b' : 'c']!)),
    );
    const x = item(bx.id);
    await a.ok('clt.put', { entity: 'cltItems', row: x });
    typing(ca!, 'cltItems', x.id);
    typing(ca!, 'cltItems', x.id);
    await vi.waitFor(() => expect(typed(cb!)).toHaveLength(1));
    await sleep(300);
    expect(typed(cb!)).toEqual([{ t: 'typing', entity: 'cltItems', id: x.id, userId: a.userId }]);
    expect(typed(ca!)).toHaveLength(0);
    expect(typed(cc!)).toHaveLength(0);
    // третий шлёт typing по чужой строке — никто ничего не получает
    typing(cc!, 'cltItems', x.id);
    typing(cc!, 'nope', x.id);
    typing(cc!, 'cltItems', uuidv7());
    await sleep(300);
    expect(typed(ca!)).toHaveLength(0);
    expect(typed(cb!)).toHaveLength(1);
    expect(typed(cc!)).toHaveLength(0);
  });
});

describe('cl1a: уведомления без задачи', () => {
  async function notif(kind: 'chat_dm' | 'chat_mention', url: string | null) {
    const row = {
      id: uuidv7(),
      userId: b.userId,
      spaceId: null,
      kind,
      taskId: null,
      url,
      body: 'Анна: созвонимся в 15:00?',
      commentId: null,
      actorId: a.userId,
      readAt: null,
      createdAt: now(),
    };
    await db.insert(schema.notifications).values(row);
    return row;
  }
  const mkQueue = () => {
    const send = vi.fn(async () => {});
    return {
      send,
      queue: new PushQueue(db, { boss: false, databaseUrl: dbUrl, sender: { send } }),
    };
  };

  it('cl1a: push chat_dm без taskId строит payload с url и body', async () => {
    await db.insert(schema.pushSubscriptions).values({
      userId: b.userId,
      endpoint: 'https://push.example/cl1a-' + uuidv7(),
      p256dh: 'k',
      auth: 'a',
    });
    const { send, queue } = mkQueue();
    const url = `/m/chat/c/${uuidv7()}/${uuidv7()}`;
    const n = await notif('chat_dm', url);
    await queue.deliver(n.id);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown[])[1]).toEqual({
      title: 'Личное сообщение',
      body: n.body,
      url,
      tag: n.id,
      kind: 'chat_dm',
    });
  });

  it('cl1a: push с чужим url не отправляется', async () => {
    const { send, queue } = mkQueue();
    for (const url of ['https://evil.example/x', '//evil.example', null])
      await queue.deliver((await notif('chat_mention', url)).id);
    expect(send).not.toHaveBeenCalled();
  });

  it('cl1a: уведомление chat_* без задачи доходит получателю через changes', async () => {
    const { ServerTx } = await import('../../src/sync/server-tx.js');
    const row = {
      id: uuidv7(),
      userId: c.userId,
      spaceId: null,
      kind: 'chat_reply' as const,
      taskId: null,
      url: '/m/chat/c/x',
      body: 'x: y',
      commentId: null,
      changes: null,
      actorId: a.userId,
      readAt: null,
      createdAt: now(),
    };
    await db.transaction((q) =>
      ServerTx.asSystem(q as never, { userId: a.userId }).put('notifications', row),
    );
    expect(await ids(c, 'notifications')).toContain(row.id);
    expect(await ids(a, 'notifications')).not.toContain(row.id);
  });
});

describe('cl1a: canReadFile', () => {
  let space: string;
  let sha: string;
  const get = (url: string, cookie: string) =>
    app.getHttpAdapter().getInstance().inject({ method: 'GET', url, headers: { cookie } });
  const upload = async (cookie: string, data: Buffer) => {
    const boundary = '----cl1a';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x.bin"\r\nContent-Type: text/plain\r\n\r\n`,
      ),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: 'POST',
        url: '/files',
        headers: {
          cookie,
          origin: ORIGIN,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });
    return res.json().sha256 as string;
  };
  const page = (files: string[]) => ({
    id: uuidv7(),
    spaceId: space,
    parentId: null,
    rank: 'a0',
    title: 'p',
    icon: null,
    body: { type: 'doc', content: [] },
    text: '',
    files,
    createdBy: a.userId,
    updatedBy: a.userId,
    archivedAt: null,
    createdAt: now(),
    updatedAt: now(),
  });

  beforeAll(async () => {
    space = await mkSpace(db, a.userId, { [a.userId]: 'admin', [b.userId]: 'member' });
    sha = await upload(cookies.a!, Buffer.from('cl1a docs file ' + uuidv7()));
    await db.insert((await import('@planar/module-docs/api/schema')).docsPages).values(page([sha]));
  });

  it('cl1a: docs — участник пространства читает файл страницы, не загрузивший и посторонний', async () => {
    expect((await get(`/files/${sha}`, cookies.a!)).statusCode).toBe(200);
    expect((await get(`/files/${sha}`, cookies.b!)).statusCode).toBe(200); // не загружал сам
    expect((await get(`/files/${sha}`, cookies.c!)).statusCode).toBe(404);
  });

  it('cl1a: docs — файл, загруженный не участником, чужой страницей не открывается', async () => {
    const other = await upload(cookies.c!, Buffer.from('cl1a outsider ' + uuidv7()));
    await db
      .insert((await import('@planar/module-docs/api/schema')).docsPages)
      .values(page([other]));
    expect(await docsApi.canReadFile!(db, b.userId, other)).toBe(false);
    expect((await get(`/files/${other}`, cookies.b!)).statusCode).toBe(404);
  });

  it('cl1a: выключенный модуль файл не открывает', async () => {
    await db
      .update(schema.settings)
      .set({ value: ['clt'] })
      .where(eq(schema.settings.id, 'enabled_modules'));
    expect((await get(`/files/${sha}`, cookies.b!)).statusCode).toBe(404);
    expect((await get(`/files/${sha}`, cookies.a!)).statusCode).toBe(200); // загрузил сам
    await db
      .update(schema.settings)
      .set({ value: ['clt', 'docs'] })
      .where(eq(schema.settings.id, 'enabled_modules'));
  });
});
