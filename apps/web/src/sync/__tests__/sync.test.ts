// @vitest-environment node
import 'fake-indexeddb/auto';
import { effectScope, nextTick, watch } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '../shared';
import { useQuery } from '../query';
import { FakeServer, FakeWebSocket } from './fake-server';
import { NOW, SPACE, label, labels, setup, stopAll, testMutators } from './helpers';

const until = async (f: () => boolean | Promise<boolean>, ms = 2000) => {
  const t = Date.now();
  while (!(await f())) {
    if (Date.now() - t > ms) throw new Error('until: таймаут');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const args = (name: string, id = uuidv7()) => ({ id, spaceId: SPACE, name, color: '#000' });

afterEach(stopAll);

describe('sync', () => {
  it('sync:optimistic — реплика меняется до ответа сервера, useQuery видит', async () => {
    const s = setup();
    const c = s.mk();
    await s.start(c);
    s.server.mode = 'offline';
    const scope = effectScope();
    const q = scope.run(() => useQuery(() => s.db.table('labels').toArray()))!;
    await until(() => q.value !== undefined);
    await c.mutate('test.label.put', args('a'));
    expect((await labels(s.db)).map((l) => l.name)).toEqual(['a']);
    await until(() => q.value?.length === 1);
    expect(s.server.pushes).toBe(0);
    await until(() => c.syncState.value.pending === 1);
    scope.stop();
    await c.stopSync();
  });

  it('sync:confirm — после push+pull мутация уходит из очереди, состояние серверное', async () => {
    const s = setup();
    const c = s.mk();
    await s.start(c);
    await c.mutate('test.label.put', args('a'));
    await c.syncNow();
    expect(await s.db._queue.count()).toBe(0);
    expect(s.server.rows.get('labels')!.size).toBe(1);
    expect((await labels(s.db))[0]).toEqual([...s.server.rows.get('labels')!.values()][0]);
    expect(c.syncState.value).toEqual({ status: 'online', pending: 0 });
    await c.stopSync();
  });

  it('sync:rollback — отклонённая мутация откатана, onMutationError вызван', async () => {
    const s = setup();
    const c = s.mk();
    const errs: unknown[] = [];
    c.onMutationError((e) => errs.push(e));
    await s.start(c);
    s.server.rejectNext = 'forbidden';
    await c.mutate('test.label.put', args('a'));
    expect(await labels(s.db)).toHaveLength(1);
    await c.syncNow();
    expect(await labels(s.db)).toHaveLength(0);
    expect(await s.db._queue.count()).toBe(0);
    expect(errs).toMatchObject([{ name: 'test.label.put', code: 'forbidden' }]);
    await c.stopSync();
  });

  it('sync:offline-queue — очередь переживает перезапуск и уходит на сервер', async () => {
    const s = setup();
    const c1 = s.mk();
    await s.start(c1);
    s.server.mode = 'offline';
    await c1.mutate('test.label.put', args('a'));
    await c1.mutate('test.label.put', args('b'));
    await c1.syncNow();
    await c1.stopSync();
    const c2 = s.mk(); // «перезагрузка»: новый клиент над той же базой
    await s.start(c2);
    expect(c2.syncState.value.pending).toBe(2);
    expect(s.server.rows.get('labels')).toBeUndefined();
    s.server.mode = 'ok';
    await c2.syncNow();
    expect(s.server.rows.get('labels')!.size).toBe(2);
    expect(await s.db._queue.count()).toBe(0);
    await c2.stopSync();
  });

  it('sync:rebase — конкурентная правка: локальная поверх серверной, затем серверная последняя', async () => {
    const s = setup();
    const l = label('orig');
    s.server.seed('labels', [l]);
    const c = s.mk();
    await s.start(c);
    s.server.mode = 'offline';
    await c.mutate('test.label.rename', { id: l.id, name: 'local' });
    await c.syncNow(); // фоновый цикл завершён (сеть недоступна)
    s.server.mode = 'ok';
    await s.server.runMutation('other', 1, 'test.label.rename', { id: l.id, name: 'remote' });
    await c.syncNow(); // pull (remote) → rebase → push (local) → pull
    expect(s.server.rows.get('labels')!.get(l.id)!.name).toBe('local');
    expect((await labels(s.db))[0].name).toBe('local');
    expect(await s.db._queue.count()).toBe(0);
    await c.stopSync();
  });

  it('sync:rebase — после pull локальная правка поверх серверного состояния', async () => {
    const s = setup();
    const l = label('orig');
    const other = label('other');
    s.server.seed('labels', [l]);
    const c = s.mk();
    await s.start(c);
    s.server.mode = 'offline';
    await c.mutate('test.label.rename', { id: l.id, name: 'local' });
    await c.syncNow(); // фоновый цикл завершён (сеть недоступна)
    s.server.seed('labels', [{ ...other }, { ...l, name: 'remote' }]);
    s.server.mode = 'ok';
    s.server.blockPush = true;
    await c.syncNow();
    const got = Object.fromEntries((await labels(s.db)).map((x) => [x.id, x.name]));
    expect(got[l.id]).toBe('local');
    expect(got[other.id]).toBe('other');
    expect(await s.db._queue.count()).toBe(1);
    await c.stopSync();
  });

  it('sync:reset — pull с reset → bootstrap, очередь поверх', async () => {
    const s = setup();
    const a = label('a');
    s.server.seed('labels', [a]);
    const c = s.mk();
    await s.start(c);
    expect(s.server.bootstraps).toBe(1);
    s.server.mode = 'offline';
    await c.mutate('test.label.put', args('mine'));
    await c.syncNow();
    s.server.mode = 'ok';
    s.server.rows.get('labels')!.delete(a.id); // на сервере строки больше нет
    s.server.log = [];
    s.server.resetNext = true;
    s.server.mode = 'ok';
    s.server.blockPush = true;
    await c.syncNow();
    expect(s.server.bootstraps).toBe(2);
    expect((await labels(s.db)).map((x) => x.name)).toEqual(['mine']);
    expect(await s.db._queue.count()).toBe(1);
    await c.stopSync();
  });

  it('sync:ws-reconnect — переподключение с растущей задержкой, poke → pull', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      FakeWebSocket.reset();
      const s = setup();
      const c = s.mk();
      await s.start(c, true);
      const w = () => FakeWebSocket.instances;
      expect(w()).toHaveLength(1);
      w()[0].drop();
      await vi.advanceTimersByTimeAsync(999);
      expect(w()).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(w()).toHaveLength(2);
      w()[1].drop();
      await vi.advanceTimersByTimeAsync(1999);
      expect(w()).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(w()).toHaveLength(3);
      w()[2].open();
      expect(JSON.parse(w()[2].sent[0])).toEqual({ t: 'hello', cursor: 0 });
      s.server.seed('labels', [label('x')]);
      const pulls = s.server.pulls;
      w()[2].poke(s.server.seq);
      await vi.advanceTimersByTimeAsync(10);
      expect(s.server.pulls).toBe(pulls + 1);
      await c.stopSync();
    } finally {
      vi.useRealTimers();
    }
  });

  it('401 → onUnauthorized', async () => {
    const s = setup();
    const c = s.mk();
    const cb = vi.fn();
    c.onUnauthorized(cb);
    s.server.mode = '401';
    await s.start(c);
    expect(cb).toHaveBeenCalledOnce();
    await c.stopSync();
  });

  it('невалидные args → invalid_args, очередь пуста', async () => {
    const s = setup();
    const c = s.mk();
    await s.start(c);
    await expect(c.mutate('test.label.put', { id: 'x' })).rejects.toMatchObject({
      code: 'invalid_args',
    });
    expect(await s.db._queue.count()).toBe(0);
    await c.stopSync();
  });

  it('registerMutators: дубликат → Error', () => {
    const c = setup().mk();
    expect(() => c.registerMutators([testMutators[0]])).toThrow();
  });
});

describe('sync:perf', () => {
  it('sync:perf — bootstrap 10 000 задач и локальная мутация', async () => {
    const server = new FakeServer(testMutators);
    // 10 пространств × 10 проектов × 5 статусов: у fake-indexeddb обслуживание индекса
    // линейно по числу строк с одним ключом, в настоящем IndexedDB (B-дерево) этого нет.
    const spaces = Array.from({ length: 10 }, () => uuidv7());
    const projects = spaces.flatMap((spaceId) =>
      Array.from({ length: 10 }, (_, i) => ({
        id: uuidv7(),
        spaceId,
        name: 'P' + i,
        key: 'P' + i,
        description: null,
        color: null,
        icon: null,
        leadId: null,
        rank: 'a0',
        archivedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      })),
    );
    const statuses = spaces.flatMap((spaceId) =>
      Array.from({ length: 5 }, (_, i) => ({
        id: uuidv7(),
        spaceId,
        name: 'S' + i,
        category: 'todo',
        color: '#000',
        rank: 'a' + i,
        createdAt: NOW,
        updatedAt: NOW,
      })),
    );
    server.seed(
      'spaces',
      spaces.map((id) => ({
        id,
        name: 'S',
        description: null,
        color: null,
        icon: null,
        rank: 'a0',
        createdBy: uuidv7(),
        createdAt: NOW,
        updatedAt: NOW,
      })),
    );
    server.seed('projects', projects);
    server.seed('statuses', statuses);
    const tasks = Array.from({ length: 10_000 }, (_, i) => {
      const p = projects[i % projects.length];
      return {
        id: uuidv7(),
        spaceId: p.spaceId,
        projectId: p.id,
        number: i + 1,
        parentId: null,
        statusId: statuses[(i * 7) % statuses.length].id,
        title: 'task ' + i,
        description: null,
        priority: 0,
        rank: 'a' + i,
        dueDate: null,
        startDate: null,
        createdBy: uuidv7(),
        completedAt: null,
        fields: {},
        createdAt: NOW,
        updatedAt: NOW,
      };
    });
    server.seed('tasks', tasks);
    const s = setup(server);
    const c = s.mk();
    let t0 = performance.now();
    await s.start(c);
    const ms = performance.now() - t0;
    expect(await s.db.table('tasks').count()).toBe(10_000);
    // vitest 5 прячет console.log прошедших тестов, а приёмка читает вывод
    process.stdout.write('perf bootstrap10k_ms=' + ms.toFixed(1) + '\n');

    const id = tasks[5000].id;
    const q = useQuery(() => s.db.table('tasks').get(id));
    await until(() => q.value !== undefined);
    server.mode = 'offline';
    const done = new Promise<void>((res) =>
      watch(q, (v) => v?.title === 'changed' && res(), { flush: 'sync' }),
    );
    t0 = performance.now();
    await c.mutate('test.task.title', { id, title: 'changed' });
    await done;
    process.stdout.write('perf mutate_ms=' + (performance.now() - t0).toFixed(1) + '\n');
    await nextTick();
    await c.stopSync();
  }, 30_000);
});
