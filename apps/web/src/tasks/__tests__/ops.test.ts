import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { domainMutators } from '@planar/shared';
import { db, registerMutators, startSync, stopSync } from '../../sync';
import { createTask, moveTask, setAssignees, setLabels, updateTask } from '../index';
import { closeAll, closePrompt } from '../closeOpen';
import { ids, reset } from './data';

beforeAll(() => registerMutators(domainMutators));
beforeEach(async () => {
  await stopSync();
  await reset();
  await db.table('spaceMembers').clear(); // clean replica; mutate requires startSync
  await startSync({
    userId: ids.ann,
    fetch: (() => Promise.reject(new TypeError('offline'))) as never,
  });
  await db._queue.clear();
});

const rank = async (id: string) => (await db.table('tasks').get(id)).rank as string;
const base = { projectId: ids.project, statusId: ids.todo };

describe('tasks:ops', () => {
  it('createTask: в конец и между соседями', async () => {
    const a = await createTask({ ...base, title: 'a' });
    const b = await createTask({ ...base, title: 'b' });
    expect((await rank(a)) < (await rank(b))).toBe(true);
    const c = await createTask({
      ...base,
      title: 'c',
      after: await rank(a),
      before: await rank(b),
    });
    expect((await rank(a)) < (await rank(c)) && (await rank(c)) < (await rank(b))).toBe(true);
  });
  it('createTask со связями создаёт исполнителей и метки', async () => {
    const a = await createTask({
      ...base,
      title: 'a',
      assigneeIds: [ids.ann],
      labelIds: [ids.bug],
    });
    expect(await db.table('taskAssignees').where('taskId').equals(a).count()).toBe(1);
    expect(await db.table('taskLabels').where('taskId').equals(a).count()).toBe(1);
  });
  it('moveTask меняет статус и rank', async () => {
    const a = await createTask({ ...base, title: 'a' });
    const b = await createTask({ ...base, title: 'b' });
    await moveTask(a, { statusId: ids.done, after: await rank(b), before: null });
    const t = await db.table('tasks').get(a);
    expect(t.statusId).toBe(ids.done);
    expect(t.rank > (await rank(b))).toBe(true);
  });
  it('setAssignees: assign/unassign по разнице', async () => {
    const a = await createTask({ ...base, title: 'a', assigneeIds: [ids.ann] });
    await db._queue.clear();
    await setAssignees(a, [ids.ann]);
    expect(await db._queue.count()).toBe(0);
    await setAssignees(a, [ids.bob]);
    expect((await db._queue.toArray()).map((q) => q.name).sort()).toEqual([
      'task.assign',
      'task.unassign',
    ]);
    const rows = await db.table('taskAssignees').where('taskId').equals(a).toArray();
    expect(rows.map((r) => r.userId)).toEqual([ids.bob]);
  });
  it('setLabels: add/remove по разнице', async () => {
    const a = await createTask({ ...base, title: 'a' });
    await setLabels(a, [ids.bug]);
    expect(await db.table('taskLabels').where('taskId').equals(a).count()).toBe(1);
    await setLabels(a, []);
    expect(await db.table('taskLabels').where('taskId').equals(a).count()).toBe(0);
  });
  it('PLNRAPP-138 завершение с открытой подзадачей спрашивает: отмена, «закрыть всё»; без открытых — сразу', async () => {
    const status = async (id: string) => (await db.table('tasks').get(id)).statusId as string;
    const until = async () => {
      while (!closePrompt.value) await new Promise((r) => setTimeout(r, 5));
      return closePrompt.value;
    };
    const parent = await createTask({ ...base, title: 'p' });
    const kid = await createTask({ ...base, title: 'k', parentId: parent });
    // cancel — nothing changes
    let done = updateTask(parent, { statusId: ids.done });
    expect((await until()).subtaskIds).toEqual([kid]);
    closePrompt.value!.answer(false);
    await done;
    expect(await status(parent)).toBe(ids.todo);
    // «close all» — the subtask too
    done = updateTask(parent, { statusId: ids.done });
    const p = await until();
    await closeAll(p);
    p.answer(true);
    await done;
    expect([await status(parent), await status(kid)]).toEqual([ids.done, ids.done]);
    // nothing open — no question
    const solo = await createTask({ ...base, title: 's' });
    await updateTask(solo, { statusId: ids.done });
    expect(await status(solo)).toBe(ids.done);
  });
});
