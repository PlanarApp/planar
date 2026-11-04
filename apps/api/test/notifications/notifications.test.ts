import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { pushPayloadSchema, uuidv7 } from '@planar/shared';
import * as schema from '../../src/db/schema.js';
import { PushQueue, QUEUE, type PushSender } from '../../src/push/push.js';
import { PullService } from '../../src/sync/pull.service.js';
import { PushService } from '../../src/sync/push.service.js';
import { dbUrl, newDb, TestClient, taskArgs, world, type World } from '../sync/helpers.js';

const db = newDb();
const sender = { send: vi.fn(async () => {}) } satisfies PushSender;
// worker disabled: check that the job sits in the queue; delivery is called manually
const queue = new PushQueue(db, { boss: true, worker: false, databaseUrl: dbUrl, sender });
// pg-boss creates the schema on first start: under load it can take longer than the test timeout
beforeAll(() => queue.onModuleInit(), 90_000);
afterAll(async () => {
  await queue.onApplicationShutdown();
  await db.$client.end();
});

const doc = (...mentions: string[]) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'hi ' },
        ...mentions.map((id) => ({ type: 'mention', attrs: { id, label: 'u' } })),
      ],
    },
  ],
});

async function setup() {
  const w = await world(db);
  const svc = { push: new PushService(db, queue), pull: new PullService(db) };
  // clients with the queue (world creates them without it)
  const wrap = (c: TestClient) => new TestClient(svc, c.userId);
  const x = {
    ...w,
    admin: wrap(w.admin),
    member: wrap(w.member),
    guest: wrap(w.guest),
    outsider: wrap(w.outsider),
  } as World;
  return x;
}

const notes = (userId: string) =>
  db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId));
const watchers = async (taskId: string) =>
  (await db.select().from(schema.taskWatchers).where(eq(schema.taskWatchers.taskId, taskId))).map(
    (r) => r.userId,
  );

async function task(w: World, over: Record<string, unknown> = {}) {
  const t = taskArgs(w, over);
  await w.admin.ok('task.create', t);
  return t;
}

describe('триггеры', () => {
  it('assigned: исполнителю, но не себе', async () => {
    const w = await setup();
    const t = await task(w);
    await w.admin.ok('task.assign', { id: uuidv7(), taskId: t.id, userId: w.member.userId });
    await w.admin.ok('task.assign', { id: uuidv7(), taskId: t.id, userId: w.admin.userId });
    expect(await notes(w.member.userId)).toMatchObject([
      { kind: 'assigned', taskId: t.id, actorId: w.admin.userId, spaceId: w.spaceId, readAt: null },
    ]);
    expect(await notes(w.admin.userId)).toHaveLength(0);
  });

  it('повтор назначения не создаёт второе уведомление', async () => {
    const w = await setup();
    const t = await task(w);
    const a = { taskId: t.id, userId: w.member.userId };
    await w.admin.ok('task.assign', { id: uuidv7(), ...a });
    await w.admin.ok('task.assign', { id: uuidv7(), ...a });
    expect(await notes(w.member.userId)).toHaveLength(1);
  });

  it('mentioned: всем упомянутым участникам, не участник пропущен', async () => {
    const w = await setup();
    const t = await task(w);
    await w.admin.ok('comment.create', {
      id: uuidv7(),
      taskId: t.id,
      body: doc(w.member.userId, w.guest.userId, w.outsider.userId),
    });
    expect(await notes(w.member.userId)).toMatchObject([{ kind: 'mentioned' }]);
    expect(await notes(w.guest.userId)).toMatchObject([{ kind: 'mentioned' }]);
    expect(await notes(w.outsider.userId)).toHaveLength(0);
  });

  it('mentioned: правка уведомляет только новых упомянутых', async () => {
    const w = await setup();
    const t = await task(w);
    const id = uuidv7();
    await w.admin.ok('comment.create', { id, taskId: t.id, body: doc(w.member.userId) });
    await w.admin.ok('comment.update', { id, body: doc(w.member.userId, w.guest.userId) });
    expect(await notes(w.member.userId)).toHaveLength(1);
    expect(await notes(w.guest.userId)).toHaveLength(1);
  });

  it('mentioned: упоминание в описании задачи — новым упомянутым, без commentId', async () => {
    const w = await setup();
    const t = await task(w);
    await w.admin.ok('task.update', { id: t.id, description: doc(w.member.userId) });
    await w.admin.ok('task.update', {
      id: t.id,
      description: doc(w.member.userId, w.guest.userId),
    });
    expect(await notes(w.member.userId)).toMatchObject([
      { kind: 'mentioned', taskId: t.id, commentId: null },
    ]);
    expect(await notes(w.guest.userId)).toHaveLength(1);
  });

  it('автор себя не упоминает', async () => {
    const w = await setup();
    const t = await task(w);
    await w.admin.ok('comment.create', { id: uuidv7(), taskId: t.id, body: doc(w.admin.userId) });
    expect(await notes(w.admin.userId)).toHaveLength(0);
  });

  it('commented: наблюдателям кроме автора и упомянутых', async () => {
    const w = await setup();
    const t = await task(w);
    await w.member.ok('task.watch', { id: uuidv7(), taskId: t.id });
    await w.guest.ok('task.watch', { id: uuidv7(), taskId: t.id });
    await w.guest.ok('comment.create', {
      id: uuidv7(),
      taskId: t.id,
      body: doc(w.member.userId),
    });
    // member mentioned → mentioned, not commented; admin — the author-watcher of the task
    expect((await notes(w.member.userId)).map((n) => n.kind)).toEqual(['mentioned']);
    expect((await notes(w.admin.userId)).map((n) => n.kind)).toEqual(['commented']);
    expect(await notes(w.guest.userId)).toHaveLength(0);
  });

  it('status_changed: наблюдателям кроме actor; без смены статуса — ничего', async () => {
    const w = await setup();
    const t = await task(w);
    await w.member.ok('task.watch', { id: uuidv7(), taskId: t.id });
    await w.member.ok('task.update', { id: t.id, title: 'новое' });
    expect(await notes(w.admin.userId)).toHaveLength(0);
    await w.member.ok('task.update', { id: t.id, statusId: w.statusIds[2] });
    const [n] = await notes(w.admin.userId);
    expect(n.kind).toBe('status_changed');
    expect(n.changes).toEqual({ statusId: [t.statusId, w.statusIds[2]] });
    expect(await notes(w.member.userId)).toHaveLength(0);
  });
});

describe('автоподписка', () => {
  it('автор задачи, исполнитель, автор комментария', async () => {
    const w = await setup();
    const t = await task(w);
    expect(await watchers(t.id)).toEqual([w.admin.userId]);
    await w.admin.ok('task.assign', { id: uuidv7(), taskId: t.id, userId: w.member.userId });
    await w.guest.ok('comment.create', { id: uuidv7(), taskId: t.id, body: doc() });
    expect((await watchers(t.id)).sort()).toEqual(
      [w.admin.userId, w.member.userId, w.guest.userId].sort(),
    );
  });

  it('уже наблюдающий не дублируется', async () => {
    const w = await setup();
    const t = await task(w);
    await w.admin.ok('comment.create', { id: uuidv7(), taskId: t.id, body: doc() });
    expect(await watchers(t.id)).toHaveLength(1);
  });
});

describe('синхронизация и откат', () => {
  it('notifications и taskWatchers в changes; получатель видит, другие нет', async () => {
    const w = await setup();
    const t = await task(w);
    const before = (await w.member.bootstrap()).cursor;
    const beforeG = (await w.guest.bootstrap()).cursor;
    await w.admin.ok('task.assign', { id: uuidv7(), taskId: t.id, userId: w.member.userId });
    const mine = (await w.member.pull(before)).changes;
    expect(mine.filter((c) => c.entity === 'notifications')).toHaveLength(1);
    expect(mine.some((c) => c.entity === 'taskWatchers')).toBe(true);
    const other = (await w.guest.pull(beforeG)).changes;
    expect(other.some((c) => c.entity === 'notifications')).toBe(false);
  });

  it('отклонённая мутация не создаёт уведомлений и подписок', async () => {
    const w = await setup();
    const t = await task(w);
    // a guest cannot assign → forbidden
    const r = await w.guest.push('task.assign', {
      id: uuidv7(),
      taskId: t.id,
      userId: w.member.userId,
    });
    expect(r).toMatchObject({ ok: false });
    expect(await notes(w.member.userId)).toHaveLength(0);
    expect(await watchers(t.id)).toEqual([w.admin.userId]);
  });
});

const jobs = async () => {
  const { rows } = await db.$client.query(`select data from pgboss.job where name = $1`, [QUEUE]);
  return rows.map((r) => r.data.notificationId as string);
};

describe('push', () => {
  it('job в очереди pg-boss на каждое уведомление', async () => {
    const w = await setup();
    const t = await task(w);
    await w.admin.ok('task.assign', { id: uuidv7(), taskId: t.id, userId: w.member.userId });
    await w.admin.ok('comment.create', {
      id: uuidv7(),
      taskId: t.id,
      body: doc(w.guest.userId),
    });
    const ids = [...(await notes(w.member.userId)), ...(await notes(w.guest.userId))].map(
      (n) => n.id,
    );
    expect(ids).toHaveLength(3); // assigned, commented (member watches), mentioned
    const queued = await jobs();
    for (const id of ids) expect(queued).toContain(id);
  });

  it('доставка: отправитель получает подписку получателя и payload', async () => {
    const w = await setup();
    const t = await task(w, { title: 'Заголовок' });
    await db.insert(schema.pushSubscriptions).values([
      { userId: w.member.userId, endpoint: 'https://push.example/m', p256dh: 'k', auth: 'a' },
      { userId: w.guest.userId, endpoint: 'https://push.example/g', p256dh: 'k', auth: 'a' },
    ]);
    await w.admin.ok('task.assign', { id: uuidv7(), taskId: t.id, userId: w.member.userId });
    const [n] = await notes(w.member.userId);
    sender.send.mockClear();
    await queue.deliver(n.id);
    expect(sender.send).toHaveBeenCalledTimes(1);
    expect(pushPayloadSchema.safeParse(sender.send.mock.calls[0][1]).success).toBe(true);
    expect(sender.send.mock.calls[0][1].url).toMatch(/^\/t\/[A-Z0-9]+-\d+$/);
    expect(sender.send).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://push.example/m' }),
      expect.objectContaining({ body: 'Заголовок', tag: n.id, kind: 'assigned' }),
    );
  });

  it('PLANARAPP-34 доставка status_changed: смена статуса второй строкой', async () => {
    const w = await setup();
    const t = await task(w, { title: 'Заголовок' });
    await w.admin.ok('task.watch', { id: uuidv7(), taskId: t.id });
    await db.insert(schema.pushSubscriptions).values({
      userId: w.admin.userId,
      endpoint: 'https://push.example/a',
      p256dh: 'k',
      auth: 'a',
    });
    await w.member.ok('task.update', { id: t.id, statusId: w.statusIds[2] });
    const [n] = await notes(w.admin.userId);
    const names = await db
      .select({ id: schema.statuses.id, name: schema.statuses.name })
      .from(schema.statuses);
    const name = (id: string) => names.find((s) => s.id === id)!.name;
    sender.send.mockClear();
    await queue.deliver(n.id);
    expect(sender.send.mock.calls[0][1].body).toBe(
      `Заголовок\n${name(t.statusId)} → ${name(w.statusIds[2])}`,
    );
  });

  it('410 от отправителя удаляет подписку, прочие ошибки — нет', async () => {
    const w = await setup();
    const t = await task(w);
    await db.insert(schema.pushSubscriptions).values([
      { userId: w.member.userId, endpoint: 'https://push.example/gone', p256dh: 'k', auth: 'a' },
      { userId: w.member.userId, endpoint: 'https://push.example/err', p256dh: 'k', auth: 'a' },
    ]);
    await w.admin.ok('task.assign', { id: uuidv7(), taskId: t.id, userId: w.member.userId });
    const [n] = await notes(w.member.userId);
    sender.send.mockImplementation(async (s) => {
      throw Object.assign(new Error('x'), { statusCode: s.endpoint.endsWith('gone') ? 410 : 500 });
    });
    await queue.deliver(n.id);
    sender.send.mockImplementation(async () => {});
    const left = await db
      .select()
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, w.member.userId));
    expect(left.map((s) => s.endpoint)).toEqual(['https://push.example/err']);
  });

  it('нет VAPID: уведомления создаются, push пропущен', async () => {
    const w = await setup();
    const q = new PushQueue(db, { boss: false, databaseUrl: dbUrl });
    const t = await task(w);
    await db.insert(schema.pushSubscriptions).values({
      userId: w.member.userId,
      endpoint: 'https://push.example/n',
      p256dh: 'k',
      auth: 'a',
    });
    await w.admin.ok('task.assign', { id: uuidv7(), taskId: t.id, userId: w.member.userId });
    const [n] = await notes(w.member.userId);
    sender.send.mockClear();
    await q.deliver(n.id);
    expect(sender.send).not.toHaveBeenCalled();
    expect(q.vapidPublicKey).toBeUndefined();
  });
});
