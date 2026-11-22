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

  it('PLNRAPP-372: комментарий с файлами — их имена в уведомлении', async () => {
    const w = await setup();
    const t = await task(w);
    // the file is uploaded by the author (POST /files)
    const sha = uuidv7().replace(/-/g, '').repeat(2);
    await db
      .insert(schema.files)
      .values({ sha256: sha, size: 3, mime: 'image/png', createdBy: w.member.userId });
    await db.insert(schema.fileUploads).values({ sha256: sha, userId: w.member.userId });
    const f = (name: string) => ({
      id: uuidv7(),
      fileSha256: sha,
      name,
      mime: 'image/png',
      size: 3,
    });
    await w.member.ok('comment.create', {
      id: uuidv7(),
      taskId: t.id,
      body: doc(),
      attachments: [f('a.png'), f('b.pdf')],
    });
    const [n] = await notes(w.admin.userId);
    expect(n).toMatchObject({ kind: 'commented', body: '📎 a.png, b.pdf' });
    await w.member.ok('comment.create', { id: uuidv7(), taskId: t.id, body: doc() });
    expect((await notes(w.admin.userId)).map((x) => x.body).sort()).toEqual([
      null,
      '📎 a.png, b.pdf',
    ]);
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

  it('PLNRAPP-710 перенос срока: запись в истории со старым и новым сроком', async () => {
    const w = await setup();
    const t = await task(w, { dueDate: '2026-11-22' });
    await w.admin.ok('task.update', { id: t.id, dueDate: '2026-11-23' });
    const rows = await db.select().from(schema.activity).where(eq(schema.activity.taskId, t.id));
    expect(rows.find((r) => r.kind === 'updated')?.changes).toEqual({
      dueDate: ['2026-11-22', '2026-11-23'],
    });
  });

  it('PLNRAPP-710 due_changed: исполнителям (даже отписанным) и наблюдателям кроме actor', async () => {
    const w = await setup();
    const t = await task(w, { dueDate: '2026-11-22' });
    await w.admin.ok('task.assign', { id: uuidv7(), taskId: t.id, userId: w.member.userId });
    await w.member.ok('task.unwatch', { taskId: t.id });
    const due = async (u: string) =>
      (await notes(u)).filter((n) => n.kind === 'due_changed').map((n) => n.changes);
    // admin (author, watcher) moves: the unsubscribed assignee gets it, the actor does not
    await w.admin.ok('task.update', { id: t.id, dueDate: '2026-11-23' });
    expect(await due(w.member.userId)).toEqual([{ dueDate: ['2026-11-22', '2026-11-23'] }]);
    expect(await due(w.admin.userId)).toEqual([]);
    // the assignee moves (clears) — to the watcher
    await w.member.ok('task.update', { id: t.id, dueDate: null });
    expect(await due(w.admin.userId)).toEqual([{ dueDate: ['2026-11-23', null] }]);
    expect(await due(w.member.userId)).toHaveLength(1);
    // without a due change — nothing
    await w.member.ok('task.update', { id: t.id, title: 'другое' });
    expect(await due(w.admin.userId)).toHaveLength(1);
  });

  it('PLNRAPP-710 перенос многих задач: по одному due_changed на задачу, без дублей', async () => {
    const w = await setup();
    const ts = [];
    for (let i = 0; i < 3; i++) {
      const t = await task(w, { dueDate: '2026-11-21' });
      // member is the assignee and a watcher at once — still one notification per task
      await w.admin.ok('task.assign', { id: uuidv7(), taskId: t.id, userId: w.member.userId });
      ts.push(t);
    }
    for (const t of ts) await w.admin.ok('task.update', { id: t.id, dueDate: '2026-11-22' });
    const due = (await notes(w.member.userId)).filter((n) => n.kind === 'due_changed');
    expect(due.map((n) => n.taskId).sort()).toEqual(ts.map((t) => t.id).sort());
  });

  it('PLNRAPP-710 доставка due_changed: даты второй строкой', async () => {
    const w = await setup();
    const t = await task(w, { title: 'Заголовок', dueDate: '2026-11-22' });
    await db.insert(schema.pushSubscriptions).values({
      userId: w.admin.userId,
      endpoint: 'https://push.example/d',
      p256dh: 'k',
      auth: 'a',
    });
    await w.member.ok('task.update', { id: t.id, dueDate: '2026-11-25' });
    const [n] = (await notes(w.admin.userId)).filter((x) => x.kind === 'due_changed');
    sender.send.mockClear();
    await queue.deliver(n!.id);
    const p = (sender.send.mock.calls[0] as unknown[])[1];
    expect(pushPayloadSchema.safeParse(p).success).toBe(true);
    expect(p).toMatchObject({
      title: 'Срок задачи изменён',
      body: 'Заголовок\n22.11.2026 → 25.11.2026',
      kind: 'due_changed',
    });
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
