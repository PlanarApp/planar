import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { effectScope } from 'vue';
import { db } from '../../sync';
import { useProjectTasks, useSpaces, useTask } from '../index';
import { ids, reset, task, until } from './data';

beforeEach(reset);

describe('tasks:query', () => {
  it('useProjectTasks собирает key, assigneeIds, labelIds и реагирует на изменение', async () => {
    const t = task(1);
    await db.table('tasks').put(t);
    await db.table('taskAssignees').put({
      id: crypto.randomUUID(),
      spaceId: ids.space,
      taskId: t.id,
      userId: ids.ann,
      createdAt: t.createdAt,
    });
    await db.table('taskLabels').put({
      id: crypto.randomUUID(),
      spaceId: ids.space,
      taskId: t.id,
      labelId: ids.bug,
      createdAt: t.createdAt,
    });
    const scope = effectScope();
    const r = scope.run(() => useProjectTasks(ids.project))!;
    const v = await until(() => r.value);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ key: 'PLN-1', assigneeIds: [ids.ann], labelIds: [ids.bug] });
    await db.table('tasks').put(task(2, { number: null }));
    const v2 = await until(() => r.value?.length === 2 && r.value);
    expect(v2.map((x) => x.key).sort()).toEqual(['PLN-1', 'PLN-…']);
    scope.stop();
  });
  it('useTask по ключу и по id', async () => {
    const t = task(1);
    await db.table('tasks').put(t);
    const scope = effectScope();
    const [byKey, byId] = scope.run(() => [useTask('PLN-1'), useTask(t.id)])!;
    expect((await until(() => byKey.value)).id).toBe(t.id);
    expect((await until(() => byId.value)).key).toBe('PLN-1');
    scope.stop();
  });
  it('useSpaces без архивных проектов', async () => {
    const scope = effectScope();
    const r = scope.run(() => useSpaces())!;
    const v = await until(() => r.value);
    expect(v[0].projects.map((p) => p.key)).toEqual(['PLN']);
    scope.stop();
  });
});
