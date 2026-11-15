import 'fake-indexeddb/auto';
import { effectScope, ref } from 'vue';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../../../sync';
import { ids, reset, task, until } from '../../../tasks/__tests__/data';
import { useSubtree, useTaskLites } from '../../../../../../modules/time/web/data';

beforeEach(reset);

describe('PLNRAPP-251 time: задачи без чтения всей таблицы', () => {
  it('useSubtree — задача и потомки по индексу parentId, следит за переносом', async () => {
    const root = task(1);
    const kid = task(2, { parentId: root.id });
    const grand = task(3, { parentId: kid.id });
    const other = task(4);
    await db.table('tasks').bulkPut([root, kid, grand, other]);
    const r = effectScope().run(() => useSubtree(() => root.id))!;
    await until(() => r.value?.size === 3);
    expect([...r.value!].sort()).toEqual([root.id, kid.id, grand.id].sort());
    await db.table('tasks').update(other.id, { parentId: grand.id });
    await until(() => r.value?.has(other.id));
  });

  it('useTaskLites — только запрошенные id, отсутствующих нет; новый набор id — новый запрос', async () => {
    const a = task(1);
    const b = task(2);
    await db.table('tasks').bulkPut([a, b]);
    const want = ref([a.id, 'missing']);
    const r = effectScope().run(() => useTaskLites(() => want.value))!;
    await until(() => r.value?.size === 1);
    expect(r.value!.get(a.id)).toEqual({
      id: a.id,
      title: 't1',
      projectId: ids.project,
      spaceId: ids.space,
    });
    want.value = [a.id, b.id];
    await until(() => r.value?.size === 2);
  });
});
