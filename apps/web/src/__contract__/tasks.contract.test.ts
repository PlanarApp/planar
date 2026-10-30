// @vitest-environment node
// Contract test web (C-tasks): exports and pure functions of the shared tasks layer per docs/contracts/web.md.
// Edited only by the web module coordinator.
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as tasks from '../tasks/index';
import type { TaskView } from '../tasks/index';

const doc = readFileSync(new URL('../../../../docs/contracts/web.md', import.meta.url), 'utf8');
const part = doc.split(/^## C-tasks v\d+\s*$/m)[1] ?? '';
const table = part.split(/^### /m).find((s) => s.startsWith('Экспорты')) ?? '';
const names = [...table.matchAll(/^\| (`\w+`(?:, `\w+`)*) \|/gm)].flatMap((m) =>
  [...m[1].matchAll(/`(\w+)`/g)].map((x) => x[1]),
);

const T0 = '2026-10-22T10:00:00.000Z';
const task = (over: Partial<TaskView>): TaskView =>
  ({
    id: over.id ?? 'x',
    spaceId: 's',
    projectId: 'p',
    number: 1,
    parentId: null,
    statusId: 'st1',
    title: 't',
    description: null,
    priority: 0,
    rank: 'a0',
    dueDate: null,
    startDate: null,
    createdBy: 'u1',
    completedAt: null,
    fields: {},
    createdAt: T0,
    updatedAt: T0,
    key: 'PLN-1',
    assigneeIds: [],
    labelIds: [],
    ...over,
  }) as TaskView;

describe('C-tasks: экспорты', () => {
  it('в контракте есть экспорты', () => {
    expect(names.length).toBeGreaterThanOrEqual(20);
  });
  it.each(names)('экспорт %s', (n) => {
    expect(
      (tasks as Record<string, unknown>)[n],
      `tasks/index.ts не экспортирует ${n}`,
    ).toBeDefined();
  });
});

describe('C-tasks: groupTasks', () => {
  const statuses = [
    { id: 'st2', rank: 'a2', name: 'Done', category: 'done', color: '#0a0', spaceId: 's' },
    { id: 'st1', rank: 'a1', name: 'Todo', category: 'todo', color: '#888', spaceId: 's' },
  ];
  const ctx = { statuses, members: [], labels: [] } as unknown as Parameters<
    typeof tasks.groupTasks
  >[2];
  it('статусы — в порядке rank', () => {
    const g = tasks.groupTasks(
      [task({ id: 'a', statusId: 'st2' }), task({ id: 'b' })],
      'status',
      ctx,
    );
    expect(g.map((x) => x.key)).toEqual(['st1', 'st2']);
  });
  it('приоритет 1→4, затем 0', () => {
    const ts = [0, 4, 1, 3, 2].map((p) => task({ id: `p${p}`, priority: p }));
    const g = tasks.groupTasks(ts, 'priority', ctx).filter((x) => x.tasks.length);
    expect(g.map((x) => x.tasks[0].priority)).toEqual([1, 2, 3, 4, 0]);
  });
  it('несколько исполнителей — в каждой группе; без исполнителя — последней', () => {
    const g = tasks
      .groupTasks(
        [task({ id: 'a', assigneeIds: ['u1', 'u2'] }), task({ id: 'b' })],
        'assignee',
        ctx,
      )
      .filter((x) => x.tasks.length);
    expect(g.filter((x) => x.tasks.some((t) => t.id === 'a'))).toHaveLength(2);
    expect(g[g.length - 1].tasks.map((t) => t.id)).toEqual(['b']);
  });
});

describe('C-tasks: sortTasks', () => {
  it('null — в конце при любом направлении, сортировка стабильна', () => {
    const ts = [
      task({ id: 'n1', dueDate: null }),
      task({ id: 'd2', dueDate: '2026-11-02' }),
      task({ id: 'd1', dueDate: '2026-11-01' }),
      task({ id: 'n2', dueDate: null }),
    ];
    expect(tasks.sortTasks(ts, 'dueDate', 'asc').map((t) => t.id)).toEqual([
      'd1',
      'd2',
      'n1',
      'n2',
    ]);
    expect(tasks.sortTasks(ts, 'dueDate', 'desc').map((t) => t.id)).toEqual([
      'd2',
      'd1',
      'n1',
      'n2',
    ]);
  });
});
