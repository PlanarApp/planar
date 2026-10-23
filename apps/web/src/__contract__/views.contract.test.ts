// @vitest-environment node
// Контрактный тест web (C-views): экспорты экрана проекта по docs/contracts/web.md.
// Правит только координатор модуля web.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as views from '../views/index';

const doc = readFileSync(
  fileURLToPath(new URL('../../../../docs/contracts/web.md', import.meta.url)),
  'utf8',
);
const part = doc.split(/^## C-views v\d+\s*$/m)[1] ?? '';
const table = part.split(/^### /m).find((s) => s.startsWith('Экспорты')) ?? '';
const rows = [...table.matchAll(/^\| `(\w+)` \| ([^|]+) \|/gm)];
const values = rows.filter((r) => !r[2].trim().startsWith('тип')).map((r) => r[1]);

describe('C-views: экспорты', () => {
  it('список из контракта', () => {
    expect(values).toEqual(['useViewOptions', 'useSelection', 'openTask', 'closeTask']);
  });
  it.each(values)('экспорт %s', (n) => {
    expect(
      (views as Record<string, unknown>)[n],
      `views/index.ts не экспортирует ${n}`,
    ).toBeDefined();
  });
});

describe('C-views: поведение', () => {
  it('useViewOptions — значения по умолчанию', () => {
    const o = views.useViewOptions('p-contract', 'list');
    expect(o.value).toEqual({
      groupBy: 'status',
      sortBy: 'rank',
      sortDir: 'asc',
      showSubtasks: false,
    });
  });
  it('useSelection — одно состояние, toggle и range от anchor', () => {
    const a = views.useSelection();
    const b = views.useSelection();
    a.clear();
    a.toggle('t2');
    expect([...b.selected.value]).toEqual(['t2']);
    b.range(['t1', 't2', 't3', 't4'], 't4');
    expect([...a.selected.value].sort()).toEqual(['t2', 't3', 't4']);
    a.clear();
    expect(b.selected.value.size).toBe(0);
  });
});
