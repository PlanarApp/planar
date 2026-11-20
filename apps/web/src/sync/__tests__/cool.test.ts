// @vitest-environment node
// PLNRAPP-489 (C-sync v3): остывание — лидер при пустой очереди удаляет детали задач без обращения 30 дней
// вместе с _held и y-indexeddb базой задачи, кроме моих открытых задач.
import 'fake-indexeddb/auto';
import { uuidv7 } from '@planar/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { COOL_AFTER_MS } from '../client';
import { NOW, PROJECT, SPACE, USER, label, setup, stopAll } from './helpers';

afterEach(stopAll);

const OTHER = uuidv7();
const OPEN = uuidv7();
const DONE = uuidv7();
const status = (id: string, category: string) => ({
  id,
  spaceId: SPACE,
  projectId: PROJECT,
  name: category,
  category,
});
const task = (statusId: string, id = uuidv7()) => ({ id, spaceId: SPACE, title: 't', statusId });
const assignee = (taskId: string, userId = USER) => ({
  id: uuidv7(),
  spaceId: SPACE,
  taskId,
  userId,
});
const comment = (taskId: string, id = uuidv7()) => ({
  id,
  spaceId: SPACE,
  taskId,
  authorId: USER,
  body: { type: 'doc' },
  mentions: [],
  editedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
});
const reaction = (commentId: string) => ({
  id: uuidv7(),
  spaceId: SPACE,
  commentId,
  userId: USER,
  emoji: '👍',
  createdAt: NOW,
});

const ydb = (taskId: string) => `v2:task:${taskId}`;
/** y-indexeddb база задачи, как её создаёт openCollab */
const openYdb = (taskId: string) =>
  new Promise<void>((resolve, reject) => {
    const r = indexedDB.open(ydb(taskId));
    r.onsuccess = () => (r.result.close(), resolve());
    r.onerror = () => reject(r.error);
  });
const ydbs = async () => (await indexedDB.databases()).map((d) => d.name);

const old = (now: number) => new Date(now - COOL_AFTER_MS - 1000).toISOString();

/**
 * v3: stale — чужая задача, mineOpen — моя открытая, mineDone — моя решённая, otherOpen — открытая чужая,
 * fresh — недавно открытая; у каждой комментарий с реакцией и y-indexeddb база.
 */
async function v3() {
  const s = setup();
  s.server.v3 = true;
  s.server.seed('statuses', [status(OPEN, 'in_progress'), status(DONE, 'done')]);
  const t = {
    stale: task(OPEN),
    mineOpen: task(OPEN),
    mineDone: task(DONE),
    otherOpen: task(OPEN),
    fresh: task(OPEN),
  };
  s.server.seed('tasks', Object.values(t));
  s.server.seed('taskAssignees', [
    assignee(t.mineOpen.id),
    assignee(t.mineDone.id),
    assignee(t.otherOpen.id, OTHER),
  ]);
  const comments = Object.fromEntries(
    Object.entries(t).map(([k, x]) => [k, comment(x.id)]),
  ) as Record<keyof typeof t, ReturnType<typeof comment>>;
  s.server.seed('comments', Object.values(comments));
  const reactions = Object.fromEntries(
    Object.entries(comments).map(([k, c]) => [k, reaction(c.id)]),
  ) as Record<keyof typeof t, ReturnType<typeof reaction>>;
  s.server.seed('commentReactions', Object.values(reactions));
  s.server.held = Object.values(t).map((x) => x.id);
  const c = s.mk();
  await s.start(c);
  for (const x of Object.values(t)) await openYdb(x.id);
  const now = Date.now();
  for (const [k, x] of Object.entries(t))
    if (k !== 'fresh') await s.db._held.update(x.id, { accessedAt: old(now) });
  return { s, c, t, comments, reactions, now };
}

describe('PLNRAPP-489: остывание деталей задач', () => {
  it('детали старше 30 дней удаляются вместе с _held и y-indexeddb базой, мои открытые — нет', async () => {
    const { s, c, t, comments, reactions, now } = await v3();
    const batches: string[] = [];
    c.onReplicaChange((b) => batches.push(...b.map((x) => x.id)));
    const cooled = await c.coolNow(now);
    const gone = [t.stale, t.mineDone, t.otherOpen].map((x) => x.id);
    const kept = [t.mineOpen, t.fresh].map((x) => x.id);
    expect(cooled.sort()).toEqual(gone.sort());
    const held = (await s.db._held.toCollection().primaryKeys()) as string[];
    expect(held.sort()).toEqual(kept.sort());
    for (const k of ['stale', 'mineDone', 'otherOpen'] as const) {
      expect(await s.db.table('comments').get(comments[k].id)).toBeUndefined();
      expect(await s.db.table('commentReactions').get(reactions[k].id)).toBeUndefined();
      expect(batches).toContain(comments[k].id);
    }
    for (const k of ['mineOpen', 'fresh'] as const) {
      expect(await s.db.table('comments').get(comments[k].id)).toBeTruthy();
      expect(await s.db.table('commentReactions').get(reactions[k].id)).toBeTruthy();
    }
    // задачи (ядро) остаются
    expect(await s.db.table('tasks').get(t.stale.id)).toBeTruthy();
    const names = await ydbs();
    for (const id of gone) expect(names).not.toContain(ydb(id));
    for (const id of kept) expect(names).toContain(ydb(id));
  });

  it('остывшая задача загружается снова через POST /sync/tasks', async () => {
    const { s, c, t, comments, now } = await v3();
    await c.coolNow(now);
    expect(await c.ensureTask(t.stale.id)).toBe(true);
    expect(s.server.tasksRequests).toBe(1);
    expect(await s.db.table('comments').get(comments.stale.id)).toBeTruthy();
    expect(await s.db._held.get(t.stale.id)).toBeTruthy();
  });

  it('при непустой очереди остывания нет', async () => {
    const { s, c, t, comments, now } = await v3();
    s.server.blockPush = true;
    await c.mutate('test.label.put', label('x'));
    expect(await s.db._queue.count()).toBe(1);
    expect(await c.coolNow(now)).toEqual([]);
    expect(await s.db._held.get(t.stale.id)).toBeTruthy();
    expect(await s.db.table('comments').get(comments.stale.id)).toBeTruthy();
    expect(await ydbs()).toContain(ydb(t.stale.id));
  });

  it('не лидер не остужает', async () => {
    const { s, c, t, now } = await v3();
    await c.stopSync();
    expect(await c.coolNow(now)).toEqual([]);
    expect(await s.db._held.get(t.stale.id)).toBeTruthy();
  });

  it('лидер остужает сам после цикла синхронизации', async () => {
    const { s, t, comments } = await v3();
    await stopAll();
    const c2 = s.mk();
    await s.start(c2); // тёплый старт: цикл без ожидания
    await c2.syncNow();
    expect(await s.db._held.get(t.stale.id)).toBeUndefined();
    expect(await s.db.table('comments').get(comments.stale.id)).toBeUndefined();
    expect(await s.db._held.get(t.mineOpen.id)).toBeTruthy();
    expect(await s.db._held.get(t.fresh.id)).toBeTruthy();
  });
});
