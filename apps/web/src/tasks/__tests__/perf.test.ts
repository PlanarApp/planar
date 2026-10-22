import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { effectScope } from 'vue';
import { db } from '../../sync';
import { useProjectTasks } from '../index';
import { ids, reset, task, until } from './data';

beforeEach(reset);

describe('tasks:perf', () => {
  it('projectTasks 10 000 задач', async () => {
    const ts = Array.from({ length: 10_000 }, (_, i) => task(i + 1));
    await db.table('tasks').bulkPut(ts);
    await db.table('taskAssignees').bulkPut(
      ts.slice(0, 5000).map((t) => ({
        id: crypto.randomUUID(),
        spaceId: ids.space,
        taskId: t.id,
        userId: ids.ann,
        createdAt: t.createdAt,
      })),
    );
    const t0 = performance.now();
    const scope = effectScope();
    const r = scope.run(() => useProjectTasks(ids.project))!;
    const v = await until(() => r.value, 20_000);
    const ms = performance.now() - t0;
    scope.stop();
    process.stdout.write('perf projectTasks10k_ms=' + ms.toFixed(1) + '\n');
    expect(v).toHaveLength(10_000);
  }, 60_000);
});
