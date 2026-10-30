// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { FakeServer } from './fake-server';
import { NOW, SPACE, setup, stopAll, testMutators } from './helpers';

afterEach(async () => {
  vi.unstubAllGlobals();
  await stopAll();
});

const project = (key: string) => ({
  id: uuidv7(),
  spaceId: SPACE,
  name: key,
  key,
  description: null,
  color: null,
  icon: null,
  leadId: null,
  rank: 'a0',
  archivedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
});
const task = (p: { id: string }, n: number) => ({
  id: uuidv7(),
  spaceId: SPACE,
  projectId: p.id,
  number: n,
  parentId: null,
  statusId: uuidv7(),
  title: 't' + n,
  description: null,
  priority: 0,
  rank: 'a' + n,
  dueDate: null,
  startDate: null,
  createdBy: uuidv7(),
  completedAt: null,
  fields: {},
  cycleId: null,
  createdAt: NOW,
  updatedAt: NOW,
});
const assignee = (t: { id: string }) => ({
  id: uuidv7(),
  spaceId: SPACE,
  taskId: t.id,
  userId: uuidv7(),
  createdAt: NOW,
});

/** server: the open project (5 tasks) and a large remainder (2500 tasks, 3 batches of ≤ 1000) */
function world(path: (hot: { id: string; key: string }) => string) {
  const hot = project('HOT');
  const cold = project('COLD');
  const server = new FakeServer(testMutators);
  server.seed('projects', [hot, cold]);
  const hotTasks = Array.from({ length: 5 }, (_, i) => task(hot, i + 1));
  const coldTasks = Array.from({ length: 2500 }, (_, i) => task(cold, i + 1));
  server.seed('tasks', [...hotTasks, ...coldTasks]);
  server.seed('taskAssignees', [assignee(hotTasks[0]), assignee(coldTasks[0])]);
  vi.stubGlobal('location', { pathname: path(hot) });
  return { server, hot, cold };
}

describe('sync:partial', () => {
  it('perf:partial bootstrap пишет открытый проект первым: partial → complete', async () => {
    const { server, hot } = world((h) => `/p/${h.id}`);
    const s = setup(server);
    const c = s.mk();
    const seen: { state: string; tasks: number; links: number }[] = [];
    const off = c.onReplicaChange(() => {
      void Promise.all([s.db.table('tasks').count(), s.db.table('taskAssignees').count()]).then(
        ([tasks, links]) => seen.push({ state: c.replicaState.value, tasks, links }),
      );
    });
    expect(c.replicaState.value).toBe('empty');
    const started = s.start(c);
    // first write: the open project entirely (5 tasks and its link), the rest is not written yet
    while (c.replicaState.value === 'empty') await new Promise((r) => setTimeout(r, 0));
    expect(c.replicaState.value).toBe('partial');
    expect(await s.db.table('tasks').where('projectId').equals(hot.id).count()).toBe(5);
    expect(await s.db.table('taskAssignees').count()).toBe(1);
    expect(await s.db.table('tasks').count()).toBeLessThan(2505);
    await started;
    off();
    expect(c.replicaState.value).toBe('complete');
    expect(await s.db.table('tasks').count()).toBe(2505);
    expect(await s.db.table('taskAssignees').count()).toBe(2);
    expect(seen.length).toBeGreaterThan(3); // reset + batches
  });

  it('perf:partial курсор сохраняется только после complete, события пачек — подписчикам', async () => {
    const { server } = world((h) => `/t/${h.key}-2`);
    const s = setup(server);
    const c = s.mk();
    const cursors: (number | undefined)[] = [];
    let rows = 0;
    const off = c.onReplicaChange((b) => {
      rows += b.filter((x) => x.entity === 'tasks').length;
      void s.db._meta.get('cursor').then((m) => cursors.push(m?.value as number | undefined));
    });
    await s.start(c);
    await new Promise((r) => setTimeout(r, 20));
    off();
    expect(cursors[0]).toBeUndefined(); // after the first write (partial) there is no cursor
    expect((await s.db._meta.get('cursor'))?.value).toBe(server.seq);
    expect(rows).toBe(2500); // the remaining tasks arrived as batch events
  });

  it('perf:partial прерванный bootstrap начинается заново', async () => {
    const { server } = world((h) => `/p/${h.id}`);
    const s = setup(server);
    const c1 = s.mk();
    const started = s.start(c1);
    while (c1.replicaState.value !== 'partial') await new Promise((r) => setTimeout(r, 0));
    await c1.stopSync(); // connection dropped between batches
    await started;
    expect((await s.db._meta.get('cursor'))?.value).toBeUndefined();
    expect(await s.db.table('tasks').count()).toBeLessThan(2505);
    const c2 = s.mk(); // "reload": no cursor → bootstrap again
    await s.start(c2);
    expect(server.bootstraps).toBe(2);
    expect(c2.replicaState.value).toBe('complete');
    expect(await s.db.table('tasks').count()).toBe(2505);
    expect((await s.db._meta.get('cursor'))?.value).toBe(server.seq);
  });

  it('perf:partial без открытого проекта — одной транзакцией, complete', async () => {
    const { server } = world(() => '/inbox');
    const s = setup(server);
    const c = s.mk();
    await s.start(c);
    expect(c.replicaState.value).toBe('complete');
    expect(await s.db.table('tasks').count()).toBe(2505);
  });
});
