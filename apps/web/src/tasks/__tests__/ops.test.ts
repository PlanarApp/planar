import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { domainMutators } from '@planar/shared';
import { db, registerMutators, startSync, stopSync } from '../../sync';
import { createTask, moveTask, setAssignees, setLabels, updateTask } from '../index';
import { closeAll, closePrompt, closeStatusFor } from '../closeOpen';
import { T, id, ids, reset } from './data';

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

  describe('PLNRAPP-805 закрытие в любой статус категории done/cancelled', () => {
    const status = async (id: string) => (await db.table('tasks').get(id)).statusId as string;
    const until = async () => {
      while (!closePrompt.value) await new Promise((r) => setTimeout(r, 5));
      return closePrompt.value;
    };
    const st = (over: Record<string, unknown>) => ({
      id: id(),
      spaceId: ids.space,
      projectId: ids.project,
      color: '#888',
      rank: 'a5',
      createdAt: T,
      updatedAt: T,
      ...over,
    });
    const other = id();
    const cancelled = st({ name: 'Отменено', category: 'cancelled', rank: 'a3' });
    const wontfix = st({ name: 'Не будем делать', category: 'cancelled', rank: 'a4' });
    const shipped = st({ name: 'Выпущено', category: 'done', rank: 'a5' });
    // the other project: «Отменено» by name, plus statuses of the categories
    const oTodo = st({ projectId: other, name: 'Todo', category: 'todo', rank: 'a1' });
    const oDone = st({ projectId: other, name: 'Done', category: 'done', rank: 'a2' });
    const oDrop = st({ projectId: other, name: 'Брошено', category: 'cancelled', rank: 'a3' });
    const oCancelled = st({
      projectId: other,
      name: 'отменено',
      category: 'cancelled',
      rank: 'a4',
    });
    beforeEach(async () => {
      await db.table('projects').put({
        id: other,
        spaceId: ids.space,
        name: 'O',
        key: 'OTH',
        description: null,
        color: null,
        icon: null,
        leadId: null,
        rank: 'a2',
        archivedAt: null,
        createdAt: T,
        updatedAt: T,
      });
      await db
        .table('statuses')
        .bulkPut([cancelled, wontfix, shipped, oTodo, oDone, oDrop, oCancelled]);
    });
    const checklist = async (taskId: string, text: string, done = false) => {
      const itemId = id();
      await db.table('checklistItems').put({
        id: itemId,
        spaceId: ids.space,
        taskId,
        text,
        done,
        rank: 'a' + text,
        assigneeId: null,
        linkedTaskId: null,
        indent: 0,
        createdAt: T,
        updatedAt: T,
      });
      return itemId;
    };
    const checked = async (itemId: string) =>
      (await db.table('checklistItems').get(itemId)).done as boolean;

    it('«Отменено»: тот же диалог; «закрыть всё» — подзадачи в «Отменено», чек-лист отмечен', async () => {
      const parent = await createTask({ ...base, title: 'p' });
      const kid = await createTask({ ...base, title: 'k', parentId: parent });
      const closedKid = await createTask({ ...base, title: 'c', parentId: parent });
      await db.table('tasks').update(closedKid, { statusId: ids.done });
      const item = await checklist(parent, '1');
      const ready = await checklist(parent, '2', true);
      const done = updateTask(parent, { statusId: cancelled.id });
      const p = await until();
      expect(p.status.id).toBe(cancelled.id);
      expect(p.subtaskIds).toEqual([kid]);
      expect(p.checklistIds).toEqual([item]);
      await closeAll(p);
      p.answer(true);
      await done;
      expect([await status(parent), await status(kid), await status(closedKid)]).toEqual([
        cancelled.id,
        cancelled.id,
        ids.done, // already closed — untouched
      ]);
      expect([await checked(item), await checked(ready)]).toEqual([true, true]);
    });

    it('пользовательский статус: только чек-лист — тоже спрашивает; пропуск — статус меняется, остальное как было', async () => {
      const parent = await createTask({ ...base, title: 'p' });
      const item = await checklist(parent, '1');
      const done = updateTask(parent, { statusId: wontfix.id });
      const p = await until();
      expect(p.subtaskIds).toEqual([]);
      expect(p.checklistIds).toEqual([item]);
      p.answer(true); // «only the task»
      await done;
      expect(await status(parent)).toBe(wontfix.id);
      expect(await checked(item)).toBe(false);
      expect(closePrompt.value).toBeNull();
    });

    it('«Готово»-подобный пользовательский статус: подзадачи уходят в статус родителя, а не в первый done', async () => {
      const parent = await createTask({ ...base, title: 'p' });
      const kid = await createTask({ ...base, title: 'k', parentId: parent });
      const done = moveTask(parent, { statusId: shipped.id, after: null, before: null });
      const p = await until();
      await closeAll(p);
      p.answer(true);
      await done;
      expect([await status(parent), await status(kid)]).toEqual([shipped.id, shipped.id]);
    });

    it('из закрытого в закрытый — без запроса', async () => {
      const parent = await createTask({ ...base, title: 'p' });
      await createTask({ ...base, title: 'k', parentId: parent });
      await db.table('tasks').update(parent, { statusId: ids.done });
      await updateTask(parent, { statusId: cancelled.id });
      expect(await status(parent)).toBe(cancelled.id);
      expect(closePrompt.value).toBeNull();
    });

    it('подзадача из другого проекта: статус с тем же именем, иначе первый той же категории', () => {
      const all = [cancelled, wontfix, shipped, oTodo, oDone, oDrop, oCancelled] as never[];
      const kid = { projectId: other };
      const pick = (to: unknown) => closeStatusFor(kid, to as never, all)?.id;
      expect(pick(cancelled)).toBe(oCancelled.id); // by name, case-insensitive
      expect(pick(wontfix)).toBe(oDrop.id); // first cancelled by rank
      expect(pick(shipped)).toBe(oDone.id);
      expect(closeStatusFor({ projectId: ids.project }, wontfix as never, all)).toBe(wontfix);
      expect(closeStatusFor({ projectId: id() }, wontfix as never, all)).toBeUndefined();
    });
  });
});
