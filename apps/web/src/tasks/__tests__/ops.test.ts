import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { domainMutators } from '@planar/shared';
import { db, registerMutators, startSync, stopSync } from '../../sync';
import { createTask, moveTask, setAssignees, setLabels } from '../index';
import { ids, reset } from './data';

beforeAll(() => registerMutators(domainMutators));
beforeEach(async () => {
  await stopSync();
  await reset();
  await db.table('spaceMembers').clear(); // чистая реплика; mutate требует startSync
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
});
