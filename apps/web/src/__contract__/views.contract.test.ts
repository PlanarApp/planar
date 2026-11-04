// @vitest-environment node
// Contract test web (C-views): exports of the project screen per docs/contracts/web.md.
// Edited only by the web module coordinator.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as views from '../views/index';

const doc = readFileSync(
  fileURLToPath(new URL('../../../../docs/contracts/web.md', import.meta.url)),
  'utf8',
);
const part = doc.split(/^## C-views v\d+\s*$/m)[1] ?? '';
const table = part.split(/^### /m).find((s) => s.startsWith('Exports')) ?? '';
const rows = [...table.matchAll(/^\| `(\w+)` \| ((?:\\\||[^|])+) \|/gm)];
const values = rows.filter((r) => !r[2].trim().startsWith('type')).map((r) => r[1]);

describe('C-views: экспорты', () => {
  it('список из контракта', () => {
    expect(values).toEqual([
      'useViewOptions',
      'useSelection',
      'openTask',
      'closeTask',
      'matchFilter',
    ]);
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
      showEmpty: false,
      wrapTitles: false,
      me: null,
      fields: ['status', 'assignee', 'priority', 'dueDate', 'labels'],
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

describe('C-views: matchFilter', () => {
  const statuses = [
    { id: 'st1', category: 'todo' },
    { id: 'st2', category: 'done' },
  ] as unknown as Parameters<typeof views.matchFilter>[2]['statuses'];
  const ctx = { statuses, userId: 'u1', today: '2026-10-23' };
  const t = (over: Record<string, unknown>) =>
    ({
      statusId: 'st1',
      priority: 0,
      dueDate: null,
      title: 'Починить вход',
      createdBy: 'u2',
      assigneeIds: [],
      labelIds: [],
      ...over,
    }) as unknown as Parameters<typeof views.matchFilter>[0];
  it('пустой фильтр — все', () => {
    expect(views.matchFilter(t({}), null, ctx)).toBe(true);
    expect(views.matchFilter(t({}), { op: 'and', rules: [] }, ctx)).toBe(true);
  });
  it('and / or, me, категория статуса', () => {
    const f = (op: 'and' | 'or') => ({
      op,
      rules: [
        { field: 'assignee' as const, operator: 'in' as const, value: ['me'] },
        { field: 'statusCategory' as const, operator: 'notIn' as const, value: ['done'] },
      ],
    });
    expect(views.matchFilter(t({ assigneeIds: ['u1'] }), f('and'), ctx)).toBe(true);
    expect(views.matchFilter(t({ assigneeIds: ['u1'], statusId: 'st2' }), f('and'), ctx)).toBe(
      false,
    );
    expect(views.matchFilter(t({ assigneeIds: ['u3'] }), f('or'), ctx)).toBe(true);
  });
  it('dueDate before today+N, isEmpty, contains', () => {
    const before = {
      op: 'and' as const,
      rules: [{ field: 'dueDate' as const, operator: 'before' as const, value: 'today+7' }],
    };
    expect(views.matchFilter(t({ dueDate: '2026-10-25' }), before, ctx)).toBe(true);
    expect(views.matchFilter(t({ dueDate: '2026-11-25' }), before, ctx)).toBe(false);
    const empty = {
      op: 'and' as const,
      rules: [{ field: 'dueDate' as const, operator: 'isEmpty' as const }],
    };
    expect(views.matchFilter(t({}), empty, ctx)).toBe(true);
    const has = {
      op: 'and' as const,
      rules: [{ field: 'title' as const, operator: 'contains' as const, value: 'ВХОД' }],
    };
    expect(views.matchFilter(t({}), has, ctx)).toBe(true);
  });
});
