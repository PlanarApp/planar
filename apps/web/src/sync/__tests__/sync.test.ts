// @vitest-environment node
import 'fake-indexeddb/auto';
import { effectScope, nextTick, reactive, watch } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uuidv7 } from '@planar/shared';
import { useQuery } from '../query';
import { FakeServer, FakeWebSocket } from './fake-server';
import { NOW, PROJECT, SPACE, USER, label, labels, setup, stopAll, testMutators } from './helpers';

const until = async (f: () => boolean | Promise<boolean>, ms = 2000) => {
  const t = Date.now();
  while (!(await f())) {
    if (Date.now() - t > ms) throw new Error('until: таймаут');
    await new Promise((r) => setTimeout(r, 5));
  }
};
const args = (name: string, id = uuidv7()) => ({
  id,
  spaceId: SPACE,
  projectId: PROJECT,
  name,
  color: '#000',
});

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

  it('sync:reactive-args — реактивные аргументы (Vue Proxy) не роняют IndexedDB', async () => {
    const s = setup();
    const c = s.mk();
    await s.start(c);
    s.server.mode = 'offline';
    await c.mutate('test.label.put', reactive(args('a')));
    expect((await labels(s.db)).map((l) => l.name)).toEqual(['a']);
    expect(await s.db._queue.count()).toBe(1);
    await c.stopSync();
  });

  it('sync:server-refuses — отказ сервера (403) виден через onMutationError, правка остаётся в очереди', async () => {
    const s = setup();
    const c = s.mk();
    const errs: { code: string; message: string }[] = [];
    c.onMutationError((e) => errs.push(e));
    await s.start(c);
    s.server.mode = '403';
    await c.mutate('test.label.put', args('a'));
    await until(() => errs.length > 0);
    expect(errs[0]).toMatchObject({
      code: 'origin_mismatch',
      message: 'Origin не совпадает с PUBLIC_URL',
    });
    expect(await s.db._queue.count()).toBe(1);
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
    const c2 = s.mk(); // "reload": a new client over the same database
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
    await c.syncNow(); // background cycle finished (network unavailable)
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
    s.server.seed('labels', [{ ...other }, { ...l, name: 'remote' }]);
    // cycle push → pull: an edit appears after push (queue empty), before the pull response; its push is blocked
    s.server.beforePull = async () => {
      s.server.blockPush = true;
      await c.mutate('test.label.rename', { id: l.id, name: 'local' });
    };
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
    s.server.rows.get('labels')!.delete(a.id); // the row is no longer on the server
    s.server.log = [];
    s.server.resetNext = true;
    s.server.beforePull = async () => {
      s.server.blockPush = true;
      await c.mutate('test.label.put', args('mine'));
    };
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

  it('sync:ws-reconnect — сервер принимает и сразу закрывает: пауза растёт', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      FakeWebSocket.reset();
      const s = setup();
      const c = s.mk();
      await s.start(c, true);
      const w = () => FakeWebSocket.instances;
      w()[0].open();
      w()[0].drop();
      for (const d of [1000, 2000, 4000]) {
        const n = w().length;
        await vi.advanceTimersByTimeAsync(d - 1);
        expect(w()).toHaveLength(n);
        await vi.advanceTimersByTimeAsync(1);
        expect(w()).toHaveLength(n + 1);
        w()[n].open();
        w()[n].drop();
      }
      await c.stopSync();
    } finally {
      vi.useRealTimers();
    }
  });

  it('sync:warm-start — зависший fetch не задерживает startSync с готовой репликой', async () => {
    const s = setup();
    s.server.seed('labels', [label('a')]);
    const c1 = s.mk();
    await s.start(c1);
    await c1.stopSync();
    const c2 = s.mk();
    const t0 = performance.now();
    await c2.startSync({
      userId: USER,
      baseUrl: 'http://test',
      fetch: ((_u: unknown, init: RequestInit) =>
        new Promise((_, rej) =>
          init.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))),
        )) as unknown as typeof fetch,
    });
    expect(performance.now() - t0).toBeLessThan(100);
    expect(await labels(s.db)).toHaveLength(1);
    await c2.stopSync();
  });

  it('sync:rebase-inapplicable — неприменимая локально мутация остаётся в очереди, судит сервер', async () => {
    const s = setup();
    const l = label('orig');
    s.server.seed('labels', [l]);
    const c = s.mk();
    const errs: { code: string }[] = [];
    c.onMutationError((e) => errs.push(e));
    await s.start(c);
    s.server.beforePull = async () => {
      s.server.blockPush = true;
      s.server.remove('labels', l.id);
      await c.mutate('test.label.rename', { id: l.id, name: 'local' });
    };
    await c.syncNow(); // push (empty) → pull: no row, rename is not applicable
    expect(await labels(s.db)).toHaveLength(0);
    expect(await s.db._queue.count()).toBe(1);
    expect(errs).toHaveLength(0);
    s.server.blockPush = false;
    await c.syncNow(); // the server rejects with not_found
    expect(await s.db._queue.count()).toBe(0);
    expect(errs).toMatchObject([{ code: 'not_found' }]);
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
    // 10 spaces × 10 projects × 5 statuses: fake-indexeddb maintains the index
    // linear in the number of rows with one key; real IndexedDB (B-tree) doesn't have this.
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
        cycleId: null,
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
    // vitest 5 hides console.log of passed tests, and acceptance reads the output
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
