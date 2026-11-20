// @vitest-environment node
// PLNRAPP-488: prefetchTasks — батчи POST /sync/tasks ≤ 100 id, не чаще PREFETCH_INTERVAL, без запроса удержанных.
import 'fake-indexeddb/auto';
import { SYNC_TASKS_MAX, uuidv7 } from '@planar/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { PREFETCH_INTERVAL } from '../client';
import { NOW, SPACE, setup, stopAll } from './helpers';

afterEach(stopAll);

const task = (id = uuidv7()) => ({ id, spaceId: SPACE, title: 't' });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(ok: () => boolean | Promise<boolean>, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error('timeout');
    await wait(10);
  }
}

async function v3(n: number) {
  const s = setup();
  s.server.v3 = true;
  const ids = Array.from({ length: n }, () => uuidv7());
  s.server.seed(
    'tasks',
    ids.map((id) => task(id)),
  );
  s.server.held = [];
  const c = s.mk();
  await s.start(c);
  return { s, c, ids };
}

describe('PLNRAPP-488: prefetchTasks', () => {
  it('250 id — батчи ≤ 100, второй не раньше PREFETCH_INTERVAL; все в _held', async () => {
    const { s, c, ids } = await v3(250);
    const t0 = Date.now();
    c.prefetchTasks(ids);
    await until(async () => (await s.db._held.count()) === 250);
    expect(s.server.tasksIds.map((x) => x.length)).toEqual([100, 100, 50]);
    expect(s.server.tasksIds.every((x) => x.length <= SYNC_TASKS_MAX)).toBe(true);
    expect(new Set(s.server.tasksIds.flat())).toEqual(new Set(ids));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2 * PREFETCH_INTERVAL - 20);
  });

  it('частые наведения склеиваются в один запрос, повтор не запрашивает', async () => {
    const { s, c, ids } = await v3(5);
    for (const id of ids) c.prefetchTasks([id]);
    await until(async () => (await s.db._held.count()) === 5);
    expect(s.server.tasksIds).toHaveLength(1);
    c.prefetchTasks(ids);
    await wait(PREFETCH_INTERVAL + 100);
    expect(s.server.tasksIds).toHaveLength(1);
  });

  it('удержанные не запрашиваются и accessedAt не меняется', async () => {
    const { s, c, ids } = await v3(2);
    const [A, B] = ids as [string, string];
    await s.db._held.put({ taskId: A, loadedAt: NOW, accessedAt: NOW });
    c.prefetchTasks([A, B]);
    await until(async () => !!(await s.db._held.get(B)));
    expect(s.server.tasksIds).toEqual([[B]]);
    expect((await s.db._held.get(A))?.accessedAt).toBe(NOW);
  });

  it('forbidden/not_found больше не предзагружаются', async () => {
    const { s, c, ids } = await v3(1);
    const gone = uuidv7();
    s.server.forbidden.add(ids[0]!);
    c.prefetchTasks([ids[0]!, gone]);
    await until(() => s.server.tasksIds.length === 1);
    await wait(PREFETCH_INTERVAL + 100);
    c.prefetchTasks([ids[0]!, gone]);
    await wait(PREFETCH_INTERVAL + 100);
    expect(s.server.tasksIds).toHaveLength(1);
  });

  it('до startSync — ничего', async () => {
    const s = setup();
    const c = s.mk();
    c.prefetchTasks([uuidv7()]);
    await wait(50);
    expect(s.server.tasksIds).toHaveLength(0);
  });
});
