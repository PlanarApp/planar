import 'fake-indexeddb/auto';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope } from 'vue';
import { domainMutators } from '@planar/shared';
import { db, registerMutators, startSync, stopSync } from '../../sync';
import { archiveTask, createTask, updateTask } from '../../tasks';
import { ids, reset, task, until } from '../../tasks/__tests__/data';
import { useSearch } from '../search';

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
beforeAll(() => registerMutators(domainMutators));
beforeEach(reset);

const open = async () => {
  const s = effectScope().run(() => useSearch())!;
  await until(() => s.ready.value);
  return s;
};

describe('cmd:search', () => {
  it('по ключу', async () => {
    await db.table('tasks').bulkPut([task(12), task(13)]);
    const s = await open();
    expect(s.search('pln-12').map((h) => h.ref)).toEqual(['PLN-12']);
  });
  it('путь: родители задачи от внешнего к внутреннему, у корневой пусто', async () => {
    const [a, b, c] = [task(1, { title: 'Корень' }), task(2, { title: 'Середина' }), task(3)];
    b.parentId = a.id as never;
    c.parentId = b.id as never;
    c.title = 'Лист';
    await db.table('tasks').bulkPut([a, b, c]);
    const s = await open();
    expect(s.search('лист')[0]?.path).toBe('PLN-1 Корень / PLN-2 Середина');
    expect(s.search('корень')[0]?.path).toBe('');
  });
  it('по слову из описания, ё=е', async () => {
    await db.table('tasks').bulkPut([task(1, { description: doc('Починить ёлку') }), task(2)]);
    const s = await open();
    expect(s.search('елку').map((h) => h.ref)).toEqual(['PLN-1']);
  });
  it('ранжирование: ключ > начало > название > описание', async () => {
    await db
      .table('tasks')
      .bulkPut([
        task(1, { title: 'x', description: doc('pln-5 тут') }),
        task(2, { title: 'про pln-5' }),
        task(3, { title: 'pln-5 начало' }),
        task(5, { title: 'ключ' }),
      ]);
    const s = await open();
    expect(s.search('pln-5').map((h) => h.ref)).toEqual(['PLN-5', 'PLN-3', 'PLN-2', 'PLN-1']);
  });
  it('PLNRAPP-251: правки после открытия — по событиям реплики, без перечитывания таблицы', async () => {
    await stopSync();
    await startSync({
      userId: ids.ann,
      fetch: (() => Promise.reject(new TypeError('offline'))) as never,
    });
    await db.table('tasks').bulkPut([task(1, { title: 'старая' })]);
    const s = await open();
    const read = vi.spyOn(db.table('tasks'), 'toArray');
    const a = await createTask({
      projectId: ids.project,
      statusId: ids.todo,
      title: 'новая зебра',
    });
    await until(() => s.search('зебра').length === 1);
    await updateTask(a, { title: 'жираф' });
    await until(() => s.search('жираф').length === 1);
    expect(s.search('зебра')).toEqual([]);
    await archiveTask(a);
    await until(() => s.search('жираф').length === 0);
    expect(s.search('старая')).toHaveLength(1);
    expect(read).not.toHaveBeenCalled();
    await stopSync();
  });
  it('cmd:perf', async () => {
    const ts = Array.from({ length: 10_000 }, (_, i) =>
      task(i + 1, { title: `задача номер ${i} про отчёт`, description: doc(`текст ${i} слово`) }),
    );
    await db.table('tasks').bulkPut(ts);
    const s = await open();
    await until(() => s.search('задача номер').length === 50, 20_000);
    const t0 = performance.now();
    const r = s.search('отчет слово');
    const ms = performance.now() - t0;
    process.stdout.write('perf search10k_ms=' + ms.toFixed(1) + '\n');
    expect(r).toHaveLength(50);
    expect(ids.project).toBeTruthy();
  }, 60_000);
});
