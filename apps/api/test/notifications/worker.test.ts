import { afterAll, expect, it, vi } from 'vitest';
import { uuidv7 } from '@planar/shared';
import * as schema from '../../src/db/schema.js';
import { PushQueue } from '../../src/push/push.js';
import { PullService } from '../../src/sync/pull.service.js';
import { PushService } from '../../src/sync/push.service.js';
import { dbUrl, newDb, TestClient, world } from '../sync/helpers.js';

const db = newDb();
const send = vi.fn(async () => {});
const queue = new PushQueue(db, { boss: true, databaseUrl: dbUrl, sender: { send } });
afterAll(async () => {
  await queue.onApplicationShutdown();
  await db.$client.end();
});

it('воркер pg-boss доставляет push после коммита мутации', async () => {
  const w = await world(db);
  const admin = new TestClient(
    { push: new PushService(db, queue), pull: new PullService(db) },
    w.admin.userId,
  );
  await db.insert(schema.pushSubscriptions).values({
    userId: w.member.userId,
    endpoint: 'https://push.example/w',
    p256dh: 'k',
    auth: 'a',
  });
  const t = {
    id: uuidv7(),
    projectId: w.projectId,
    statusId: w.statusIds[1],
    title: 'T',
    rank: 'a0',
  };
  await admin.ok('task.create', t);
  await admin.ok('task.assign', { id: uuidv7(), taskId: t.id, userId: w.member.userId });
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1), { timeout: 50_000 });
  expect(send.mock.calls[0]).toMatchObject([
    { endpoint: 'https://push.example/w' },
    { kind: 'assigned' },
  ]);
}, 60_000);
