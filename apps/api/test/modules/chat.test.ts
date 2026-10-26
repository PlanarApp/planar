import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import WebSocket from 'ws';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@planar/shared';
import * as schema from '../../src/db/schema.js';
import { createApp } from '../../src/app.js';
import { PushQueue } from '../../src/push/push.js';
import { PushService } from '../../src/sync/push.service.js';
import { PullService } from '../../src/sync/pull.service.js';
import { ORIGIN, loginCookie } from '../auth.js';
import {
  dbUrl,
  doc,
  mkUser,
  newDb,
  services,
  TestClient,
  world,
  type World,
} from '../sync/helpers.js';

type R = Record<string, unknown> & { id: string };
const db = newDb();
const dataDir = mkdtempSync(join(tmpdir(), 'planar-chat-'));
let w: World;
let app: Awaited<ReturnType<typeof createApp>>;
let wsUrl: string;
let cookies: Record<string, string>;
let spaceMember: TestClient; // третий в пространстве: не участник диалога
let iadmin: TestClient;
const sockets: WebSocket[] = [];

const mention = (id: string, label = 'x') => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'mention', attrs: { id, label } },
        { type: 'text', text: ' hi' },
      ],
    },
  ],
});
const rows = async (c: TestClient, e: string) =>
  (((await c.bootstrap()).data as Record<string, R[]>)[e] ?? []) as R[];
const pulled = async (c: TestClient, cursor = 0) => (await c.pull(cursor)).changes;
const chan = async (c: TestClient, id: string) =>
  (await rows(c, 'chatChannels')).find((r) => r.id === id);
const msg = async (id: string) =>
  (await db.execute(sql`select * from chat_messages where id = ${id}`)).rows[0] as Record<
    string,
    unknown
  >;

async function mkChannel(by = w.member, name = 'general') {
  const id = uuidv7();
  await by.ok('chat.channel.create', { id, spaceId: w.spaceId, name });
  return id;
}
const send = (c: TestClient, channelId: string, over: Record<string, unknown> = {}) => {
  const id = uuidv7();
  return c
    .push('chat.message.send', { id, channelId, body: doc('hello'), readId: uuidv7(), ...over })
    .then((r) => ({ id, r }));
};
const sendOk = async (c: TestClient, channelId: string, over: Record<string, unknown> = {}) => {
  const { id, r } = await send(c, channelId, over);
  expect(r, JSON.stringify(r)).toMatchObject({ ok: true });
  return id;
};
async function mkDm(by: TestClient, users: TestClient[]) {
  const id = uuidv7();
  await by.ok('chat.dm.create', {
    id,
    members: users.map((u) => ({ id: uuidv7(), userId: u.userId })),
  });
  return id;
}
const notifs = async (userId: string) =>
  db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
const jobs = async () =>
  (await db.execute(sql`select data from pgboss.job where name = 'push.notification'`)).rows.map(
    (r) => (r.data as { notificationId: string }).notificationId,
  );

beforeAll(async () => {
  w = await world(db);
  iadmin = new TestClient(services(db), await mkUser(db, 'admin'));
  await iadmin.ok('settings.set', { id: 'enabled_modules', value: ['chat'] });
  app = await createApp({
    databaseUrl: dbUrl,
    publicUrl: ORIGIN,
    dataDir,
    push: { boss: true, worker: false },
  });
  await app.listen(0, '127.0.0.1');
  wsUrl = `ws://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/ws`;
  // клиенты с очередью приложения: push ставит задачи в pg-boss
  const svc = { push: new PushService(db, app.get(PushQueue)), pull: new PullService(db) };
  for (const k of ['admin', 'member', 'guest', 'outsider'] as const)
    w[k] = new TestClient(svc, w[k].userId);
  spaceMember = new TestClient(svc, await mkUser(db, 'member'));
  await w.admin.ok('member.add', {
    id: uuidv7(),
    spaceId: w.spaceId,
    userId: spaceMember.userId,
    role: 'member',
  });
  cookies = Object.fromEntries(
    await Promise.all(
      Object.entries({
        admin: w.admin,
        member: w.member,
        guest: w.guest,
        outsider: w.outsider,
        third: spaceMember,
      }).map(async ([k, c]) => [k, await loginCookie(db, c.userId)] as const),
    ),
  );
});
afterAll(async () => {
  for (const s of sockets) s.terminate();
  await app.close();
  await db.$client.end();
});

const get = (url: string, who: string) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({ method: 'GET', url, headers: { cookie: cookies[who]! } });

describe('chat: каналы и права', () => {
  it('channel.create: member ок, guest и посторонний — forbidden, пустое имя — invalid_args', async () => {
    const id = await mkChannel();
    expect(await chan(w.guest, id)).toMatchObject({ name: 'general', kind: 'channel', lastSeq: 0 });
    const a = { id: uuidv7(), spaceId: w.spaceId, name: 'x' };
    expect(await w.guest.push('chat.channel.create', a)).toMatchObject({ code: 'forbidden' });
    expect(await w.outsider.push('chat.channel.create', a)).toMatchObject({ code: 'forbidden' });
    expect(await w.member.push('chat.channel.create', { ...a, name: '  ' })).toMatchObject({
      code: 'invalid_args',
    });
  });

  it('channel.create: projectId своего пространства, чужой проект → invalid_args', async () => {
    const id = uuidv7();
    await w.member.ok('chat.channel.create', {
      id,
      spaceId: w.spaceId,
      projectId: w.projectId,
      name: 'p',
    });
    expect(await chan(w.member, id)).toMatchObject({ projectId: w.projectId });
    const other = await world(db);
    expect(
      await w.member.push('chat.channel.create', {
        id: uuidv7(),
        spaceId: w.spaceId,
        projectId: other.projectId,
        name: 'x',
      }),
    ).toMatchObject({ code: 'invalid_args' });
  });

  it('channel.delete: создатель удаляет канал с тредом; другой member — forbidden', async () => {
    const id = await mkChannel();
    const root = await sendOk(w.member, id);
    await sendOk(w.member, id, { parentId: root });
    expect(await w.guest.push('chat.channel.delete', { id })).toMatchObject({ code: 'forbidden' });
    await w.member.ok('chat.channel.delete', { id });
    expect(await chan(w.member, id)).toBeUndefined();
    expect(await msg(root)).toBeUndefined();
  });

  it('channel.update: создатель и admin могут, другой member — нет; dm — invalid_args', async () => {
    const id = await mkChannel();
    expect(await spaceMember.push('chat.channel.update', { id, name: 'z' })).toMatchObject({
      code: 'forbidden',
    });
    await w.member.ok('chat.channel.update', { id, name: ' new ', topic: 't' });
    await w.admin.ok('chat.channel.update', { id, archivedAt: new Date().toISOString() });
    expect(await chan(w.member, id)).toMatchObject({ name: 'new', topic: 't' });
    const dm = await mkDm(w.member, [w.member, w.admin]);
    expect(await w.member.push('chat.channel.update', { id: dm, name: 'z' })).toMatchObject({
      code: 'invalid_args',
    });
  });

  it('канал не виден постороннему: bootstrap и pull', async () => {
    const id = await mkChannel();
    expect(await chan(w.outsider, id)).toBeUndefined();
    expect((await pulled(w.outsider)).some((c) => c.id === id)).toBe(false);
    expect((await get(`/api/chat/channels/${id}/messages`, 'outsider')).statusCode).toBe(404);
  });
});

describe('chat: сообщения', () => {
  it('send: seq растёт, ответ не трогает lastSeq, replyCount растёт, read автора', async () => {
    const ch = await mkChannel();
    const m1 = await sendOk(w.member, ch);
    const m2 = await sendOk(w.guest, ch); // guest пишет в канал
    expect(await msg(m1)).toMatchObject({ seq: 1, reply_count: 0 });
    expect(await msg(m2)).toMatchObject({ seq: 2 });
    const r1 = await sendOk(w.admin, ch, { parentId: m1 });
    await sendOk(w.admin, ch, { parentId: m1 });
    expect(await msg(r1)).toMatchObject({ seq: null, parent_id: m1 });
    expect(await msg(m1)).toMatchObject({ reply_count: 2 });
    expect(await chan(w.member, ch)).toMatchObject({ lastSeq: 2 });
    const reads = (await rows(w.member, 'chatReads')).find((r) => r.channelId === ch);
    expect(reads).toMatchObject({ lastReadSeq: 1, muted: false });
    await sendOk(w.member, ch);
    expect((await rows(w.member, 'chatReads')).find((r) => r.channelId === ch)).toMatchObject({
      lastReadSeq: 3,
    });
  });

  it('send: посторонний — forbidden; архивный канал — conflict; плохой parent — invalid_args', async () => {
    const ch = await mkChannel();
    expect((await send(w.outsider, ch)).r).toMatchObject({ code: 'forbidden' });
    const m = await sendOk(w.member, ch);
    const rep = await sendOk(w.member, ch, { parentId: m });
    const other = await mkChannel();
    const om = await sendOk(w.member, other);
    expect((await send(w.member, ch, { parentId: rep })).r).toMatchObject({ code: 'invalid_args' });
    expect((await send(w.member, ch, { parentId: om })).r).toMatchObject({ code: 'invalid_args' });
    await w.member.ok('chat.channel.update', { id: ch, archivedAt: new Date().toISOString() });
    expect((await send(w.member, ch)).r).toMatchObject({ code: 'conflict' });
  });

  it('send: упоминание постороннего отбрасывается, body > 64 КБ — invalid_args', async () => {
    const ch = await mkChannel();
    const body = {
      type: 'doc',
      content: [
        { type: 'mention', attrs: { id: w.admin.userId } },
        { type: 'mention', attrs: { id: w.outsider.userId } },
        { type: 'mention', attrs: { id: w.admin.userId } },
      ],
    };
    const id = await sendOk(w.member, ch, { body });
    expect((await msg(id)).mentions).toEqual([w.admin.userId]);
    expect((await send(w.member, ch, { body: doc('x'.repeat(70_000)) })).r).toMatchObject({
      code: 'invalid_args',
    });
  });

  it('update/delete: только автор; удалённое не правится; delete стирает тело и реакции', async () => {
    const ch = await mkChannel();
    const m = await sendOk(w.member, ch, { body: mention(w.admin.userId) });
    expect(await w.admin.push('chat.message.update', { id: m, body: doc('x') })).toMatchObject({
      code: 'forbidden',
    });
    expect(await w.admin.push('chat.message.delete', { id: m })).toMatchObject({
      code: 'forbidden',
    });
    await w.member.ok('chat.message.update', { id: m, body: doc('edited') });
    expect(await msg(m)).toMatchObject({ mentions: [] });
    expect((await msg(m)).edited_at).not.toBeNull();
    await w.admin.ok('chat.reaction.toggle', { id: uuidv7(), messageId: m, emoji: '👍' });
    await sendOk(w.admin, ch, { parentId: m });
    await w.member.ok('chat.message.delete', { id: m });
    expect(await msg(m)).toMatchObject({
      body: { type: 'doc', content: [] },
      mentions: [],
      attachments: [],
      reply_count: 1,
    });
    expect((await msg(m)).deleted_at).not.toBeNull();
    const rs = await db.execute(sql`select 1 from chat_reactions where message_id = ${m}`);
    expect(rs.rows).toHaveLength(0);
    expect(await w.member.push('chat.message.update', { id: m, body: doc('x') })).toMatchObject({
      code: 'conflict',
    });
    expect(
      await w.admin.push('chat.reaction.toggle', { id: uuidv7(), messageId: m, emoji: '👍' }),
    ).toMatchObject({ code: 'conflict' });
  });

  it('reaction.toggle: поставить и снять, у каждого свои; посторонний — forbidden', async () => {
    const ch = await mkChannel();
    const m = await sendOk(w.member, ch);
    const tg = (c: TestClient, emoji = '🔥') =>
      c.ok('chat.reaction.toggle', { id: uuidv7(), messageId: m, emoji });
    const count = async () =>
      (await db.execute(sql`select 1 from chat_reactions where message_id = ${m}`)).rows.length;
    await tg(w.member);
    await tg(w.admin);
    expect(await count()).toBe(2);
    await tg(w.member);
    expect(await count()).toBe(1);
    expect(
      await w.outsider.push('chat.reaction.toggle', { id: uuidv7(), messageId: m, emoji: 'x' }),
    ).toMatchObject({ code: 'forbidden' });
  });

  it('read: не больше lastSeq и не назад; mute; чужие метки не видны', async () => {
    const ch = await mkChannel();
    await sendOk(w.member, ch);
    await sendOk(w.member, ch);
    const rd = (c: TestClient, n: number) =>
      c.ok('chat.read', { id: uuidv7(), channelId: ch, lastReadSeq: n });
    const mine = async (c: TestClient) =>
      (await rows(c, 'chatReads')).find((r) => r.channelId === ch);
    await rd(w.admin, 99);
    expect(await mine(w.admin)).toMatchObject({ lastReadSeq: 2 });
    await rd(w.admin, 1);
    expect(await mine(w.admin)).toMatchObject({ lastReadSeq: 2 });
    await w.guest.ok('chat.mute', { id: uuidv7(), channelId: ch, muted: true });
    expect(await mine(w.guest)).toMatchObject({ muted: true, lastReadSeq: 0 });
    expect(await mine(w.outsider)).toBeUndefined();
    expect(
      await w.outsider.push('chat.read', { id: uuidv7(), channelId: ch, lastReadSeq: 1 }),
    ).toMatchObject({ code: 'forbidden' });
  });
});

describe('chat: личные диалоги и утечки (Q1)', () => {
  const att = (sha: string) => [{ fileSha256: sha, name: 'a.txt', mime: 'text/plain', size: 3 }];
  const upload = async (who: string, data: Buffer) => {
    const boundary = '----chat';
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
          cookie: cookies[who]!,
          origin: ORIGIN,
          'content-type': `multipart/form-data; boundary=${boundary}`,
        },
        payload,
      });
    return res.json().sha256 as string;
  };

  it('dm.create: проверки состава', async () => {
    const dm = (members: { id: string; userId: string }[]) =>
      w.member.push('chat.dm.create', { id: uuidv7(), members });
    const m = (u: string) => ({ id: uuidv7(), userId: u });
    expect(await dm([m(w.member.userId)])).toMatchObject({ code: 'invalid_args' });
    expect(await dm([m(w.admin.userId), m(w.guest.userId)])).toMatchObject({
      code: 'invalid_args',
    }); // без себя
    expect(await dm([m(w.member.userId), m(w.member.userId)])).toMatchObject({
      code: 'invalid_args',
    });
    expect(await dm([m(w.member.userId), m(uuidv7())])).toMatchObject({ code: 'invalid_args' });
    const gone = await mkUser(db);
    await db
      .update(schema.users)
      .set({ deactivatedAt: new Date().toISOString() })
      .where(eq(schema.users.id, gone));
    expect(await dm([m(w.member.userId), m(gone)])).toMatchObject({ code: 'invalid_args' });
    const many = await Promise.all(Array.from({ length: 8 }, () => mkUser(db)));
    expect(await dm([m(w.member.userId), ...many.map(m)])).toMatchObject({ code: 'invalid_args' }); // 9
  });

  it('третий не получает строк диалога: bootstrap, pull, REST', async () => {
    const acur = (await w.admin.bootstrap()).cursor;
    const dm = await mkDm(w.member, [w.member, w.admin]);
    const cur = (await spaceMember.bootstrap()).cursor;
    const m = await sendOk(w.member, dm);
    await w.admin.ok('chat.reaction.toggle', { id: uuidv7(), messageId: m, emoji: '👍' });
    for (const c of [spaceMember, w.guest, w.outsider]) {
      const b = (await c.bootstrap()).data as Record<string, R[]>;
      expect(b.chatChannels?.some((r) => r.id === dm) ?? false).toBe(false);
      expect(b.chatMembers?.some((r) => r.channelId === dm) ?? false).toBe(false);
      const ids = (await pulled(c, 0)).map((x) => x.id);
      expect(ids).not.toContain(dm);
      expect(ids).not.toContain(m);
    }
    const ch = (await pulled(spaceMember, cur)).filter((x) =>
      ['chatMessages', 'chatReactions', 'chatMembers', 'chatChannels'].includes(x.entity),
    );
    expect(ch.filter((x) => (x.data as R | null)?.channelId === dm || x.id === dm)).toEqual([]);
    expect((await get(`/api/chat/channels/${dm}/messages`, 'third')).statusCode).toBe(404);
    expect((await get(`/api/chat/messages/${m}/thread`, 'third')).statusCode).toBe(404);
    // участники видят всё
    const mc = (await pulled(w.admin, acur)).filter(
      (x) => x.entity.startsWith('chat') && (x.id === dm || (x.data as R | null)?.channelId === dm),
    );
    expect(mc.map((x) => x.entity)).toEqual(
      expect.arrayContaining(['chatChannels', 'chatMembers', 'chatMessages', 'chatReactions']),
    );
    expect((await get(`/api/chat/channels/${dm}/messages`, 'admin')).statusCode).toBe(200);
    // чужой не пишет, на диалог не реагирует
    expect((await send(spaceMember, dm)).r).toMatchObject({ code: 'forbidden' });
    expect(
      await spaceMember.push('chat.reaction.toggle', { id: uuidv7(), messageId: m, emoji: 'x' }),
    ).toMatchObject({ code: 'forbidden' });
    expect(
      await spaceMember.push('chat.dm.addMember', {
        id: uuidv7(),
        channelId: dm,
        userId: spaceMember.userId,
      }),
    ).toMatchObject({ code: 'forbidden' });
  });

  it('WS typing: участник диалога получает, третий — нет', async () => {
    const dm = await mkDm(w.member, [w.member, w.admin]);
    const connect = (who: string) => {
      const ws = new WebSocket(wsUrl, { headers: { cookie: cookies[who]!, origin: ORIGIN } });
      sockets.push(ws);
      const msgs: Record<string, unknown>[] = [];
      ws.on('message', (d) => msgs.push(JSON.parse(d.toString())));
      return new Promise<{ ws: WebSocket; msgs: typeof msgs }>((res, rej) => {
        ws.on('open', () => res({ ws, msgs }));
        ws.on('error', rej);
      });
    };
    const [cm, ca, ct] = await Promise.all([connect('member'), connect('admin'), connect('third')]);
    const typed = (x: { msgs: Record<string, unknown>[] }) =>
      x.msgs.filter((m) => m.t === 'typing');
    cm!.ws.send(JSON.stringify({ t: 'typing', entity: 'chatChannels', id: dm }));
    await vi.waitFor(() => expect(typed(ca!)).toHaveLength(1));
    ct!.ws.send(JSON.stringify({ t: 'typing', entity: 'chatChannels', id: dm })); // третий шлёт сам — никому
    await new Promise((r) => setTimeout(r, 300));
    expect(typed(ct!)).toHaveLength(0);
    expect(typed(cm!)).toHaveLength(0);
    expect(typed(ca!)).toEqual([
      { t: 'typing', entity: 'chatChannels', id: dm, userId: w.member.userId },
    ]);
  });

  it('GET /files: вложение диалога читают участники, третий — 404; канал — участники пространства', async () => {
    const dm = await mkDm(w.member, [w.member, w.admin]);
    const sha = await upload('member', Buffer.from('chat dm file ' + uuidv7()));
    expect((await get(`/files/${sha}`, 'admin')).statusCode).toBe(404); // ещё не приложен
    await sendOk(w.member, dm, { attachments: att(sha) });
    expect((await get(`/files/${sha}`, 'admin')).statusCode).toBe(200);
    expect((await get(`/files/${sha}`, 'third')).statusCode).toBe(404);
    expect((await get(`/files/${sha}`, 'outsider')).statusCode).toBe(404);
    const ch = await mkChannel();
    const sha2 = await upload('member', Buffer.from('chat ch file ' + uuidv7()));
    await sendOk(w.member, ch, { attachments: att(sha2) });
    expect((await get(`/files/${sha2}`, 'third')).statusCode).toBe(200);
    expect((await get(`/files/${sha2}`, 'outsider')).statusCode).toBe(404);
    // чужой sha256 без своей загрузки файла не открывает
    const foreign = await upload('outsider', Buffer.from('chat foreign ' + uuidv7()));
    await sendOk(w.member, ch, { attachments: att(foreign) });
    expect((await get(`/files/${foreign}`, 'third')).statusCode).toBe(404);
  });

  it('dm.leave: del канала и участников выходящему (data = null), новые сообщения не приходят', async () => {
    const dm = await mkDm(w.member, [w.member, w.admin, w.guest]);
    const cur = (await w.guest.bootstrap()).cursor;
    await w.guest.ok('chat.dm.leave', { channelId: dm });
    const ch = await pulled(w.guest, cur);
    const dels = ch.filter((c) => c.op === 'del');
    expect(dels.map((d) => d.entity)).toEqual(
      expect.arrayContaining(['chatChannels', 'chatMembers']),
    );
    expect(dels.every((d) => d.data == null)).toBe(true);
    expect(await chan(w.guest, dm)).toBeUndefined();
    const cur2 = (await w.guest.bootstrap()).cursor;
    const m = await sendOk(w.member, dm);
    expect((await pulled(w.guest, cur2)).some((c) => c.id === m)).toBe(false);
    expect((await send(w.guest, dm)).r).toMatchObject({ code: 'forbidden' });
    expect((await get(`/api/chat/channels/${dm}/messages`, 'guest')).statusCode).toBe(404);
    // оставшиеся видят уход
    expect((await rows(w.admin, 'chatMembers')).filter((r) => r.channelId === dm)).toHaveLength(2);
    // повторный leave — ничего
    await w.guest.ok('chat.dm.leave', { channelId: dm });
  });

  it('dm.addMember: новый получает канал и участников, лимит 8 — conflict, повтор — ничего', async () => {
    const dm = await mkDm(w.member, [w.member, w.admin]);
    await w.admin.ok('chat.dm.addMember', {
      id: uuidv7(),
      channelId: dm,
      userId: spaceMember.userId,
    });
    expect(await chan(spaceMember, dm)).toBeDefined();
    expect((await rows(spaceMember, 'chatMembers')).filter((r) => r.channelId === dm)).toHaveLength(
      3,
    );
    await w.admin.ok('chat.dm.addMember', {
      id: uuidv7(),
      channelId: dm,
      userId: spaceMember.userId,
    });
    expect((await rows(w.admin, 'chatMembers')).filter((r) => r.channelId === dm)).toHaveLength(3);
    const extra = await Promise.all(Array.from({ length: 5 }, () => mkUser(db)));
    for (const u of extra)
      await w.admin.ok('chat.dm.addMember', { id: uuidv7(), channelId: dm, userId: u });
    expect(
      await w.admin.push('chat.dm.addMember', {
        id: uuidv7(),
        channelId: dm,
        userId: w.guest.userId,
      }),
    ).toMatchObject({ code: 'conflict' });
    const ch = await mkChannel();
    expect(
      await w.admin.push('chat.dm.addMember', {
        id: uuidv7(),
        channelId: ch,
        userId: w.guest.userId,
      }),
    ).toMatchObject({ code: 'invalid_args' });
  });

  it('server-tx: del строк space|members пишется с data = null', async () => {
    const dm = await mkDm(w.member, [w.member, w.admin]);
    const m = await sendOk(w.member, dm);
    const ch = await mkChannel();
    const cm = await sendOk(w.member, ch);
    await w.admin.ok('chat.reaction.toggle', { id: uuidv7(), messageId: m, emoji: 'a' });
    await w.admin.ok('chat.reaction.toggle', { id: uuidv7(), messageId: cm, emoji: 'a' });
    await w.member.ok('chat.message.delete', { id: m }); // del реакции в диалоге
    await w.member.ok('chat.message.delete', { id: cm }); // и в канале
    await w.admin.ok('chat.dm.leave', { channelId: dm });
    const dels = await db
      .select()
      .from(schema.changes)
      .where(and(eq(schema.changes.op, 'del'), sql`${schema.changes.entity} like 'chat%'`));
    expect(dels.length).toBeGreaterThanOrEqual(3);
    expect(dels.every((d) => d.data === null)).toBe(true);
  });
});
describe('chat: уведомления и push', () => {
  it('упоминание → chat_mention; автор и упомянутый-автор без уведомления; push в очереди', async () => {
    const ch = await mkChannel();
    const m = await sendOk(w.member, ch, {
      body: {
        type: 'doc',
        content: [
          { type: 'mention', attrs: { id: w.admin.userId } },
          { type: 'mention', attrs: { id: w.member.userId } },
        ],
      },
    });
    const n = (await notifs(w.admin.userId)).filter((x) => x.url?.includes(m));
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({
      kind: 'chat_mention',
      taskId: null,
      spaceId: w.spaceId,
      actorId: w.member.userId,
      url: `/m/chat/c/${ch}/${m}`,
    });
    expect(n[0]!.body!.length).toBeLessThanOrEqual(140);
    expect((await notifs(w.member.userId)).some((x) => x.url?.includes(m))).toBe(false);
    expect(await jobs()).toContain(n[0]!.id);
  });

  it('группа из трёх: упомянутый — chat_mention, прочим без уведомления; 1:1 → chat_dm', async () => {
    const dm = await mkDm(w.member, [w.member, w.admin, w.guest]);
    const m = await sendOk(w.member, dm, { body: mention(w.admin.userId) });
    const of = async (u: TestClient, id: string) =>
      (await notifs(u.userId)).filter((x) => x.url?.includes(id));
    expect((await of(w.admin, m)).map((x) => x.kind)).toEqual(['chat_mention']);
    expect(await of(w.guest, m)).toHaveLength(0);
    expect(await of(w.member, m)).toHaveLength(0);
    const one = await mkDm(w.member, [w.member, w.guest]);
    const m2 = await sendOk(w.member, one);
    expect((await of(w.guest, m2)).map((x) => x.kind)).toEqual(['chat_dm']);
    expect((await of(w.guest, m2))[0]).toMatchObject({
      spaceId: null,
      url: `/m/chat/c/${one}/${m2}`,
    });
    expect(await jobs()).toContain((await of(w.guest, m2))[0]!.id);
  });

  it('ответ в треде → chat_reply автору корня и прежним авторам ответов, url треда', async () => {
    const ch = await mkChannel();
    const root = await sendOk(w.member, ch);
    await sendOk(w.guest, ch, { parentId: root });
    const r = await sendOk(w.admin, ch, { parentId: root });
    const of = async (u: TestClient) =>
      (await notifs(u.userId)).filter((x) => x.url?.includes(r) || x.url?.endsWith(`/t/${root}`));
    expect((await of(w.member)).map((x) => x.kind)).toContain('chat_reply');
    expect((await of(w.guest)).map((x) => x.kind)).toContain('chat_reply');
    expect((await of(w.guest)).every((x) => x.url === `/m/chat/c/${ch}/t/${root}`)).toBe(true);
    expect((await of(w.admin)).filter((x) => x.actorId === w.admin.userId)).toHaveLength(0);
    expect((await notifs(spaceMember.userId)).filter((x) => x.url?.includes(ch))).toHaveLength(0);
  });

  it('muted — без уведомления; сообщение без адресатов — без уведомлений', async () => {
    const ch = await mkChannel();
    await w.admin.ok('chat.mute', { id: uuidv7(), channelId: ch, muted: true });
    const before = (await notifs(w.admin.userId)).length;
    await sendOk(w.member, ch, { body: mention(w.admin.userId) });
    await sendOk(w.member, ch);
    expect((await notifs(w.admin.userId)).length).toBe(before);
  });

  it('правка: уведомление только новому упомянутому', async () => {
    const ch = await mkChannel();
    const m = await sendOk(w.member, ch, { body: mention(w.admin.userId) });
    await w.member.ok('chat.message.update', {
      id: m,
      body: {
        type: 'doc',
        content: [
          { type: 'mention', attrs: { id: w.admin.userId } },
          { type: 'mention', attrs: { id: w.guest.userId } },
        ],
      },
    });
    expect((await notifs(w.admin.userId)).filter((x) => x.url?.includes(m))).toHaveLength(1);
    expect((await notifs(w.guest.userId)).filter((x) => x.url?.includes(m))).toHaveLength(1);
  });

  it('идемпотентность: повтор push с тем же id мутации — одно сообщение и одно уведомление', async () => {
    const ch = await mkChannel();
    const id = uuidv7();
    const req = {
      clientId: uuidv7(),
      mutations: [
        {
          id: 1,
          name: 'chat.message.send',
          args: { id, channelId: ch, body: mention(w.admin.userId), readId: uuidv7() },
        },
      ],
    };
    const svc = (w.member as unknown as { svc: { push: PushService } }).svc;
    const a = await svc.push.push(w.member.userId, req);
    const b = await svc.push.push(w.member.userId, req);
    expect(b.results).toEqual(a.results);
    expect(a.results[0]).toMatchObject({ ok: true });
    expect((await db.execute(sql`select 1 from chat_messages where id = ${id}`)).rows).toHaveLength(
      1,
    );
    expect((await notifs(w.admin.userId)).filter((x) => x.url?.includes(id))).toHaveLength(1);
    expect(await chan(w.member, ch)).toMatchObject({ lastSeq: 1 });
  });
});

describe('chat: REST', () => {
  it('history: before/limit, порядок по seq, реакции; ответов в ленте нет', async () => {
    const ch = await mkChannel();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await sendOk(w.member, ch));
    await sendOk(w.admin, ch, { parentId: ids[0] });
    await w.admin.ok('chat.reaction.toggle', { id: uuidv7(), messageId: ids[4], emoji: '👍' });
    const h = async (q = '', who = 'guest') =>
      (await get(`/api/chat/channels/${ch}/messages${q}`, who)).json();
    const all = await h();
    expect(all.messages.map((m: R) => m.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(all.reactions).toMatchObject([{ messageId: ids[4], emoji: '👍' }]);
    expect(typeof all.messages[0].createdAt).toBe('string');
    expect((await h('?limit=2')).messages.map((m: R) => m.seq)).toEqual([4, 5]);
    expect((await h('?before=4&limit=2')).messages.map((m: R) => m.seq)).toEqual([2, 3]);
    expect((await h('?before=1')).messages).toEqual([]);
    expect((await get(`/api/chat/channels/${ch}/messages?limit=500`, 'guest')).statusCode).toBe(
      400,
    );
    expect((await get(`/api/chat/channels/${ch}/messages`, 'outsider')).statusCode).toBe(404);
    expect((await get(`/api/chat/channels/${uuidv7()}/messages`, 'guest')).statusCode).toBe(404);
  });

  it('thread: корень, ответы по createdAt, реакции; ответ вместо корня и посторонний — 404', async () => {
    const ch = await mkChannel();
    const root = await sendOk(w.member, ch);
    const r1 = await sendOk(w.admin, ch, { parentId: root });
    const r2 = await sendOk(w.guest, ch, { parentId: root });
    await w.admin.ok('chat.reaction.toggle', { id: uuidv7(), messageId: r1, emoji: 'x' });
    const t = (await get(`/api/chat/messages/${root}/thread`, 'guest')).json();
    expect(t.root.id).toBe(root);
    expect(t.replies.map((m: R) => m.id)).toEqual([r1, r2]);
    expect(t.reactions).toHaveLength(1);
    expect((await get(`/api/chat/messages/${r1}/thread`, 'guest')).statusCode).toBe(404);
    expect((await get(`/api/chat/messages/${root}/thread`, 'outsider')).statusCode).toBe(404);
  });

  it('выключенный модуль: REST — 404 module_disabled', async () => {
    const ch = await mkChannel();
    await iadmin.ok('settings.set', { id: 'enabled_modules', value: [] });
    const r = await get(`/api/chat/channels/${ch}/messages`, 'member');
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe('module_disabled');
    await iadmin.ok('settings.set', { id: 'enabled_modules', value: ['chat'] });
  });
});
