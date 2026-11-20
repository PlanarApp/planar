// @vitest-environment node
// PLNRAPP-486 (C-sync v3): ensureTask — снимок POST /sync/tasks через applyServer, фильтр деталей по _held, сброс _held.
import 'fake-indexeddb/auto';
import { uuidv7 } from '@planar/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { NOW, SPACE, USER, label, setup, stopAll } from './helpers';

afterEach(stopAll);

const task = (id = uuidv7()) => ({ id, spaceId: SPACE, title: 't' });
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
const reaction = (commentId: string, id = uuidv7()) => ({
  id,
  spaceId: SPACE,
  commentId,
  userId: USER,
  emoji: '👍',
  createdAt: NOW,
});

const ids = (rows: { id?: unknown; taskId?: unknown }[]) =>
  rows.map((r) => (r.id ?? r.taskId) as string).sort();

/** v3-сервер: задачи A (held) и B (не held), у каждой по комментарию */
async function v3() {
  const s = setup();
  s.server.v3 = true;
  const A = uuidv7();
  const B = uuidv7();
  s.server.seed('tasks', [task(A), task(B)]);
  const cA = comment(A);
  const cB = comment(B);
  s.server.seed('comments', [cA, cB]);
  s.server.held = [A];
  const c = s.mk();
  await s.start(c);
  return { s, c, A, B, cA, cB };
}

describe('PLNRAPP-486: _held и ensureTask', () => {
  it('bootstrap v3 создаёт _held по held', async () => {
    const { s, A } = await v3();
    expect(ids(await s.db._held.toArray())).toEqual([A]);
  });

  it('ensureTask: снимок заменяет детали задачи целиком и пишет _held', async () => {
    const { s, c, B, cB } = await v3();
    const r = reaction(cB.id);
    const fresh = comment(B);
    s.server.seed('commentReactions', [r]);
    s.server.seed('comments', [fresh]);
    s.server.remove('comments', cB.id); // на сервере комментария уже нет; его реакция осталась сиротой
    s.server.log = []; // pull ничего не приносит: детали — только из снимка
    const local = comment(B);
    await s.db.table('comments').put(local); // строка задачи, которой нет в снимке
    await s.db.table('commentReactions').put(r); // реакция на удалённый комментарий
    expect(await c.ensureTask(B)).toBe(true);
    expect(s.server.tasksRequests).toBe(1);
    const comments = await s.db.table('comments').where('taskId').equals(B).toArray();
    expect(ids(comments)).toEqual([fresh.id]);
    expect(await s.db.table('commentReactions').get(r.id)).toBeUndefined();
    const h = await s.db._held.get(B);
    expect(h?.loadedAt).toBeTruthy();
    expect(h?.accessedAt).toBe(h?.loadedAt);
  });

  it('ensureTask удержанной задачи — только accessedAt, без запроса', async () => {
    const { s, c, A } = await v3();
    await s.db._held.put({ taskId: A, loadedAt: NOW, accessedAt: NOW });
    expect(await c.ensureTask(A)).toBe(true);
    expect(s.server.tasksRequests).toBe(0);
    const h = await s.db._held.get(A);
    expect(h?.loadedAt).toBe(NOW);
    expect(h!.accessedAt > NOW).toBe(true);
  });

  it('снимок со старым cursor отбрасывается', async () => {
    const { s, c, B, cB } = await v3();
    await s.db.table('comments').delete(cB.id);
    s.server.tasksCursor = 0; // снимок старше локального cursor
    expect(await c.ensureTask(B)).toBe(false);
    expect(s.server.tasksRequests).toBe(3);
    expect(await s.db._held.get(B)).toBeUndefined();
    expect(await s.db.table('comments').get(cB.id)).toBeUndefined();
  });

  it('pull обогнал снимок: снимок отброшен, повторный запрос применяется', async () => {
    const { s, c, B } = await v3();
    const late = comment(B);
    s.server.beforeTasks = async () => {
      // снимок уже снят, а сервер ушёл вперёд и клиент успел сделать pull
      s.server.seed('labels', [label('x')]);
      await c.syncNow();
    };
    s.server.seed('comments', [late]); // в первый снимок попадёт, в pull — нет (B не в _held)
    expect(await c.ensureTask(B)).toBe(true);
    expect(s.server.tasksRequests).toBe(2);
    expect((await s.db._meta.get('cursor'))?.value).toBe(s.server.seq);
    expect(await s.db.table('comments').get(late.id)).toBeTruthy();
    expect(await s.db._held.get(B)).toBeTruthy();
  });

  it('forbidden/not_found: детали задачи и её _held удаляются', async () => {
    const { s, c, A, B, cA, cB } = await v3();
    // B не удержана, но её детали в реплике (как после bootstrap v2)
    s.server.forbidden.add(B);
    expect(await c.ensureTask(B)).toBe(true);
    expect(await s.db.table('comments').get(cB.id)).toBeUndefined();
    expect(await s.db._held.get(B)).toBeUndefined();

    s.server.remove('tasks', A);
    await s.db._held.delete(A);
    expect(await c.ensureTask(A)).toBe(true);
    expect(await s.db.table('comments').get(cA.id)).toBeUndefined();
    expect(await s.db._held.get(A)).toBeUndefined();
  });

  it('запись деталей и _held атомарна: сбой записи _held — детали не записаны', async () => {
    const { s, c, B, cB } = await v3();
    await s.db.table('comments').delete(cB.id);
    const put = s.db._held.put.bind(s.db._held);
    s.db._held.put = (() => Promise.reject(new Error('boom'))) as unknown as typeof put;
    await expect(c.ensureTask(B)).rejects.toThrow('boom');
    s.db._held.put = put;
    expect(await s.db.table('comments').get(cB.id)).toBeUndefined();
    expect(await s.db._held.get(B)).toBeUndefined();
  });

  it('pull v3: изменения деталей задачи не из _held отбрасываются, cursor продвигается', async () => {
    const { s, c, A, B } = await v3();
    const a2 = comment(A);
    const b2 = comment(B);
    s.server.seed('comments', [a2, b2]);
    s.server.seed('commentReactions', [reaction(a2.id), reaction(b2.id)]);
    await c.syncNow();
    expect(await s.db.table('comments').get(a2.id)).toBeTruthy();
    expect(await s.db.table('comments').get(b2.id)).toBeUndefined();
    const rs = await s.db.table('commentReactions').toArray();
    expect(rs.map((r) => r.commentId)).toEqual([a2.id]);
    expect((await s.db._meta.get('cursor'))?.value).toBe(s.server.seq);
  });

  it('pull v2 (без taskId) не фильтрует детали', async () => {
    const { s, c, B } = await v3();
    s.server.v3 = false;
    const b2 = comment(B);
    s.server.seed('comments', [b2]);
    await c.syncNow();
    expect(await s.db.table('comments').get(b2.id)).toBeTruthy();
  });

  it('сброс реплики очищает _held', async () => {
    const { s, c, A, B } = await v3();
    await c.ensureTask(B);
    expect(ids(await s.db._held.toArray())).toEqual([A, B].sort());
    // reset → bootstrap: _held — только из нового held
    s.server.held = [];
    s.server.resetNext = true;
    await c.syncNow();
    expect(await s.db._held.count()).toBe(0);

    s.server.held = [A];
    s.server.resetNext = true;
    await c.syncNow();
    expect(ids(await s.db._held.toArray())).toEqual([A]);

    await c.clearLocal();
    expect(await s.db._held.count()).toBe(0);
  });
});
