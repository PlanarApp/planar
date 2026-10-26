import 'fake-indexeddb/auto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { domainMutators, uuidv7, type Row } from '@planar/shared';
import { db, registerMutators, startSync, stopSync } from '../../sync';
import { FakeServer } from '../../sync/__tests__/fake-server';
import { createTask, deleteTask, setAssignees, setLabels, updateTask } from '../index';
import {
  prefetchProject,
  projectionKeys,
  resetProjections,
  useProjectTasks,
  useScopeTasks,
} from '../projection';
import type { TaskView } from '../queries';
import { T, ids, reset, task, until } from './data';

beforeAll(() => registerMutators(domainMutators));
beforeEach(async () => {
  await stopSync();
  resetProjections();
  await reset();
  await startSync({
    userId: ids.ann,
    fetch: (() => Promise.reject(new TypeError('offline'))) as never,
  });
  await db._queue.clear();
});
afterEach(() => vi.restoreAllMocks());

const byId = (a: TaskView[]) => [...a].sort((x, y) => (x.id < y.id ? -1 : 1));
const tick = () => new Promise((r) => setTimeout(r, 30));
/** проекция совпала с полным чтением (событие приходит чуть позже коммита) */
const sameAsFull = (r: { value: TaskView[] | undefined }, pid: string) =>
  vi.waitFor(async () => expect(byId(r.value!)).toEqual(await fullRead(pid)), { timeout: 3000 });

/** эталон: полное чтение проекта из IndexedDB, как до проекции */
async function fullRead(pid: string): Promise<TaskView[]> {
  const project = await db.table<Row<'projects'>>('projects').get(pid);
  const tasks = await db.table<Row<'tasks'>>('tasks').where('projectId').equals(pid).toArray();
  const set = new Set(tasks.map((t) => t.id));
  const links = async <R extends { taskId: string; id: string }>(name: string) =>
    (await db.table<R>(name).toArray()).filter((r) => set.has(r.taskId));
  const [as, ls] = await Promise.all([
    links<Row<'taskAssignees'>>('taskAssignees'),
    links<Row<'taskLabels'>>('taskLabels'),
  ]);
  return byId(
    tasks.map((t) => ({
      ...t,
      key: `${project?.key}-${t.number ?? '…'}`,
      assigneeIds: as.filter((x) => x.taskId === t.id).map((x) => x.userId),
      labelIds: ls.filter((x) => x.taskId === t.id).map((x) => x.labelId),
    })),
  );
}

const base = { projectId: ids.project, statusId: ids.todo };
const mkProject = (key: string) => ({
  id: uuidv7(),
  spaceId: ids.space,
  name: key,
  key,
  description: null,
  color: null,
  icon: null,
  leadId: null,
  rank: 'a' + key,
  archivedAt: null,
  createdAt: T,
  updatedAt: T,
});

function open(pid: string) {
  const scope = effectScope();
  const r = scope.run(() => useProjectTasks(pid))!;
  return { r, stop: () => scope.stop() };
}

describe('tasks:projection', () => {
  it('perf:projection правка не перечитывает IndexedDB', async () => {
    const t1 = await createTask({ ...base, title: 'a' });
    const t2 = await createTask({ ...base, title: 'b' });
    const { r, stop } = open(ids.project);
    await until(() => r.value?.length === 2);
    const where = vi.spyOn(db.table('tasks'), 'where');
    const toArray = vi.spyOn(db.table('tasks'), 'toArray');
    const links = vi.spyOn(db.table('taskAssignees'), 'toArray');
    await updateTask(t1, { title: 'a2' });
    await setAssignees(t2, [ids.ann]);
    await until(() => r.value?.find((t) => t.id === t1)?.title === 'a2');
    await until(() => r.value?.find((t) => t.id === t2)?.assigneeIds.length === 1);
    expect(where).not.toHaveBeenCalled();
    expect(toArray).not.toHaveBeenCalled();
    expect(links).not.toHaveBeenCalled();
    stop();
  });

  it('perf:projection патч по onReplicaChange = полное чтение после серии мутаций', async () => {
    const other = mkProject('OTH');
    await db.table('projects').put(other);
    const a = await createTask({
      ...base,
      title: 'a',
      assigneeIds: [ids.ann],
      labelIds: [ids.bug],
    });
    const b = await createTask({ ...base, title: 'b' });
    const c = await createTask({ ...base, title: 'c', priority: 2 });
    const { r, stop } = open(ids.project);
    await until(() => r.value?.length === 3);
    await updateTask(a, { title: 'a2', statusId: ids.done });
    await setAssignees(b, [ids.ann, ids.bob]);
    await setLabels(c, [ids.bug]);
    await setAssignees(a, []);
    const d = await createTask({ ...base, title: 'd', assigneeIds: [ids.bob] });
    await updateTask(c, { projectId: other.id }); // уехала в другой проект
    await updateTask(d, { title: 'd2' });
    await deleteTask(b);
    await sameAsFull(r, ids.project);
    const got = byId(r.value!);
    expect(got.map((t) => t.title).sort()).toEqual(['a2', 'd2']);
    // задача вернулась из другого проекта — связи подтягиваются из реплики
    await updateTask(c, { projectId: ids.project });
    await sameAsFull(r, ids.project);
    expect(r.value!.find((t) => t.id === c)!.labelIds).toEqual([ids.bug]);
    stop();
  });

  it('perf:projection applyServer и rebase дают тот же результат, что полное чтение', async () => {
    const t1 = task(1);
    const t2 = task(2);
    await db.table('tasks').bulkPut([t1, t2]);
    await db.table('taskAssignees').put({
      id: uuidv7(),
      spaceId: ids.space,
      taskId: t1.id,
      userId: ids.ann,
      createdAt: T,
    });
    // сервер с теми же данными; клиент загружает их bootstrap-ом
    const server = new FakeServer(domainMutators);
    for (const t of db.entityTables()) server.seed(t.name, await t.toArray());
    const fetch = server.fetch as typeof globalThis.fetch;
    await stopSync();
    await startSync({ userId: ids.ann, fetch });
    const { r, stop } = open(ids.project);
    await until(() => r.value?.length === 2);

    server.mode = 'offline';
    await updateTask(t1.id, { title: 'local' }); // локальная правка до обмена
    await setAssignees(t2.id, [ids.bob]);
    await server.runMutation('other', 1, 'task.update', { id: t1.id, title: 'remote' });
    await server.runMutation('other', 2, 'task.assign', {
      id: uuidv7(),
      taskId: t1.id,
      userId: ids.bob,
    });
    server.mode = 'ok';
    await stopSync();
    await startSync({ userId: ids.ann, fetch }); // push → pull → rebase
    await until(async () => (await db._queue.count()) === 0);
    await vi.waitFor(
      () => {
        const got = byId(r.value!);
        expect(got.find((t) => t.id === t1.id)).toMatchObject({ title: 'local' });
        expect([...got.find((t) => t.id === t1.id)!.assigneeIds].sort()).toEqual(
          [ids.ann, ids.bob].sort(),
        );
        expect(got.find((t) => t.id === t2.id)!.assigneeIds).toEqual([ids.bob]);
      },
      { timeout: 3000 },
    );
    await sameAsFull(r, ids.project);
    stop();
  });

  it('perf:projection удаление строки и событие другой вкладки (BroadcastChannel)', async () => {
    const t = task(1);
    await db.table('tasks').put(t);
    const { r, stop } = open(ids.project);
    await until(() => r.value?.length === 1);
    await db.table('tasks').delete(t.id); // через мост data.ts: как запись другой вкладки
    await until(() => r.value?.length === 0);
    stop();
  });

  it('perf:projection LRU вытесняет 4-й проект, возврат в него читает заново', async () => {
    const ps = ['P1', 'P2', 'P3', 'P4'].map(mkProject);
    await db.table('projects').bulkPut(ps);
    for (const p of ps) await db.table('tasks').put(task(1, { projectId: p.id }));
    const [a, b, c, d] = ps.map((p) => p.id);
    for (const id of [a, b, c]) prefetchProject(id);
    expect(projectionKeys()).toEqual([a, b, c]);
    prefetchProject(c); // повтор — ничего
    prefetchProject(b); // b стал самым свежим
    expect(projectionKeys()).toEqual([a, c, b]);
    prefetchProject(d); // 4-й вытесняет самый давний
    expect(projectionKeys()).toEqual([c, b, d]);
    await tick();
    prefetchProject(a); // a вытеснен — строится заново и вытесняет c
    expect(projectionKeys()).toEqual([b, d, a]);
    const { r, stop } = open(a);
    await until(() => r.value?.length === 1);
    stop();
  });

  it('perf:projection сводка больше KEEP проектов получает правки всех (ранние не вытесняются до подписки)', async () => {
    const ps = ['P1', 'P2', 'P3', 'P4', 'P5'].map(mkProject);
    await db.table('projects').bulkPut(ps);
    for (const p of ps) await db.table('tasks').put(task(1, { projectId: p.id }));
    const scope = effectScope();
    const r = scope.run(() => useScopeTasks(ps.map((p) => p.id)))!;
    await until(() => r.value?.length === 5);
    const first = r.value!.find((x) => x.projectId === ps[0].id)!;
    await updateTask(first.id, { dueDate: '2026-10-18' });
    await until(() => r.value?.find((x) => x.id === first.id)?.dueDate === '2026-10-18');
    scope.stop();
  });

  it('perf:projection при многих проектах связи читаются точечно, а не таблицей целиком', async () => {
    const big = mkProject('BIG');
    await db.table('projects').put(big);
    // реплика больше 20 000 задач, проект 600 из них при 30 000 связей чужих проектов: доля < 1/20 → anyOf
    await db
      .table('tasks')
      .bulkPut(Array.from({ length: 600 }, (_, i) => task(i + 1, { projectId: big.id })));
    const foreigns = Array.from({ length: 20_001 }, (_, i) => task(i + 1));
    const foreign = foreigns[0];
    await db.table('tasks').bulkPut(foreigns);
    await db.table('taskAssignees').bulkPut(
      Array.from({ length: 30_000 }, (_, i) => ({
        id: uuidv7(),
        spaceId: ids.space,
        taskId: foreigns[i % 15_000].id, // foreign получает 2 связи
        userId: ids.ann,
        createdAt: T,
      })),
    );
    const all = vi.spyOn(db.table('taskAssignees'), 'toArray');
    const { r, stop } = open(big.id);
    await until(() => r.value?.length === 600, 10_000);
    expect(all).not.toHaveBeenCalled();
    // задача из другого проекта приходит со своими связями (у индекса проекта их нет — проект перечитывается)
    await updateTask(foreign.id, { projectId: big.id });
    await until(() => r.value?.find((x) => x.id === foreign.id)?.assigneeIds.length === 2, 10_000);
    expect(r.value).toHaveLength(601);
    stop();
  }, 60_000);
});
