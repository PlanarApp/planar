import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { effectScope } from 'vue';
import { db } from '../../sync';
import { ids, reset, task, until } from '../../tasks/__tests__/data';
import { useSearch } from '../search';

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
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
