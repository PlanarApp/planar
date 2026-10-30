import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../../modules/dashboards/web/data', async () => {
  const { ref } = await import('vue');
  return {
    openTask: vi.fn(),
    tr: (k: string) => k,
    locale: () => 'en',
    useWeekStart: () => ref(1),
    useNames: () =>
      ref({ s1: 'Todo', s2: 'Done', u1: 'Ann', u2: 'Bob', c1: 'High', l1: 'bug', l2: 'ui' }),
    useFilterCtx: () => ref({ statuses: [], userId: 'me', today: '2026-10-21' }),
  };
});

import { web } from '../../../../../../modules/dashboards/web';
import WidgetBody from '../../../../../../modules/dashboards/web/WidgetBody.vue';
import {
  boardTasks,
  choiceNames,
  groupableFields,
  compute,
  moveBox,
  nextY,
  resizeBox,
  weekOf,
  type Task,
} from '../../../../../../modules/dashboards/web/lib';

const ctx = { statuses: [], userId: 'me', today: '2026-10-21' };
const none = { op: 'and' as const, rules: [] };
const task = (o: Record<string, unknown>): Task =>
  ({
    id: 'T' + Math.random(),
    spaceId: 'sp1',
    projectId: 'p1',
    statusId: 's1',
    title: 't',
    priority: 0,
    dueDate: null,
    completedAt: null,
    createdAt: '2026-10-21T10:00:00.000Z',
    updatedAt: '2026-10-21T10:00:00.000Z',
    fields: {},
    assigneeIds: [],
    labelIds: [],
    ...o,
  }) as unknown as Task;
const w = (kind: string, config: Record<string, unknown> = {}) =>
  ({ kind, config: { filter: none, ...config } }) as never;

describe('pt4: dashboards web', () => {
  it('pt4: number — задачи, прошедшие фильтр (matchFilter)', () => {
    const ts = [task({ priority: 1 }), task({ priority: 1 }), task({ priority: 3 })];
    const f = { op: 'and', rules: [{ field: 'priority', operator: 'in', value: [1] }] };
    expect(compute(w('number', { filter: f }), ts, ctx)).toEqual({ kind: 'number', value: 2 });
    expect(compute(w('number'), ts, ctx)).toEqual({ kind: 'number', value: 3 });
  });

  it('pt4: bars по status', () => {
    const ts = [task({}), task({}), task({ statusId: 's2' })];
    expect(compute(w('bars', { groupBy: 'status' }), ts, ctx)).toEqual({
      kind: 'bars',
      bars: [
        { key: 's1', n: 2 },
        { key: 's2', n: 1 },
      ],
    });
  });

  it('pt4: bars по assignee и label — задача в каждом столбце, пустое — отдельный', () => {
    const ts = [
      task({ assigneeIds: ['u1', 'u2'], labelIds: ['l1'] }),
      task({ assigneeIds: ['u1'], labelIds: ['l1', 'l2'] }),
      task({}),
    ];
    const bars = (g: string) =>
      Object.fromEntries(
        (
          compute(w('bars', { groupBy: g }), ts, ctx) as { bars: { key: string; n: number }[] }
        ).bars.map((b) => [b.key, b.n]),
      );
    expect(bars('assignee')).toEqual({ u1: 2, u2: 1, '': 1 });
    expect(bars('label')).toEqual({ l1: 2, l2: 1, '': 1 });
  });

  it('pt4: bars по field:<id> и priority', () => {
    const ts = [task({ fields: { f1: 'a' }, priority: 2 }), task({ fields: { f1: ['a', 'b'] } })];
    const r = compute(w('bars', { groupBy: 'field:f1' }), ts, ctx) as {
      bars: { key: string; n: number }[];
    };
    expect(Object.fromEntries(r.bars.map((b) => [b.key, b.n]))).toEqual({ a: 2, b: 1 });
    expect(
      (compute(w('bars', { groupBy: 'priority' }), ts, ctx) as { bars: unknown[] }).bars,
    ).toHaveLength(2);
  });

  it('pt4: line created/completed по неделям, окно weeks', () => {
    const now = new Date(2026, 9, 21, 12); // Wed, week from Mon 2026-10-19
    const at = (d: number, h = 12) => new Date(2026, 9, d, h).toISOString();
    const ts = [
      task({ createdAt: at(20), completedAt: at(21) }),
      task({ createdAt: at(21), completedAt: null }),
      task({ createdAt: at(13), completedAt: at(14) }),
      task({ createdAt: new Date(2026, 0, 1).toISOString() }), // outside the window
    ];
    const pts = (series: string) =>
      (
        compute(w('line', { series, weeks: 4 }), ts, ctx, now) as {
          points: { start: string; n: number }[];
        }
      ).points;
    expect(pts('created').map((p) => p.n)).toEqual([0, 0, 1, 2]);
    expect(pts('created').at(-1)?.start).toBe('2026-10-19');
    expect(pts('completed').map((p) => p.n)).toEqual([0, 0, 1, 1]);
    expect(weekOf(new Date(2026, 9, 18), 0)).toBe('2026-10-18');
  });

  it('pt4: list — sort и limit', () => {
    const ts = [
      task({
        title: 'a',
        updatedAt: '2026-10-01T00:00:00.000Z',
        dueDate: '2026-12-01',
        priority: 3,
      }),
      task({ title: 'b', updatedAt: '2026-10-03T00:00:00.000Z', dueDate: null, priority: 0 }),
      task({
        title: 'c',
        updatedAt: '2026-10-02T00:00:00.000Z',
        dueDate: '2026-11-01',
        priority: 1,
      }),
    ];
    const titles = (sort: string, limit: number) =>
      (compute(w('list', { sort, limit }), ts, ctx) as { tasks: Task[] }).tasks.map((t) => t.title);
    expect(titles('updatedAt', 10)).toEqual(['b', 'c', 'a']);
    expect(titles('dueDate', 2)).toEqual(['c', 'a']);
    expect(titles('priority', 3)).toEqual(['c', 'a', 'b']);
  });

  it('pt4: задачи дашборда (и личного) — только его пространства', () => {
    const ts = [task({ spaceId: 'sp1' }), task({ spaceId: 'sp2' }), task({ spaceId: 'sp2' })];
    expect(boardTasks('sp2', ts)).toHaveLength(2);
    expect(boardTasks('sp1', ts)).toHaveLength(1);
  });

  it('pt4: сетка — перенос и размер в пределах 12 колонок', () => {
    const b = { x: 8, y: 1, w: 4, h: 2 };
    expect(moveBox(b, 5, -9)).toEqual({ x: 8, y: 0, w: 4, h: 2 });
    expect(moveBox(b, -20, 3)).toEqual({ x: 0, y: 4, w: 4, h: 2 });
    expect(resizeBox(b, 5, 20)).toEqual({ x: 8, y: 1, w: 4, h: 12 });
    expect(resizeBox(b, -9, -9)).toEqual({ x: 8, y: 1, w: 1, h: 1 });
    expect(nextY([b, { x: 0, y: 0, w: 1, h: 1 }])).toBe(3);
  });

  it('pt4: WidgetBody рисует число, столбцы SVG и список', async () => {
    const ts = [task({ assigneeIds: ['u1'], title: 'Hello' }), task({ statusId: 's2' })];
    const mk = (kind: string, config: Record<string, unknown>) =>
      mount(WidgetBody, {
        props: {
          widget: { id: 'w', kind, config: { filter: none, ...config } } as never,
          tasks: ts,
        },
      });
    expect(mk('number', {}).get('[data-test=number]').text()).toBe('2');
    const bars = mk('bars', { groupBy: 'status' });
    expect(bars.findAll('svg rect')).toHaveLength(2);
    expect(bars.text()).toContain('Todo');
    expect(mk('list', { sort: 'updatedAt', limit: 1 }).findAll('[data-test=item]')).toHaveLength(1);
    expect(mk('line', { series: 'created', weeks: 4 }).find('polyline').exists()).toBe(true);
  });

  it('pt4: field:<id> — только select/user, подписи — названия вариантов', async () => {
    const defs = [
      {
        id: 'f1',
        name: 'Sev',
        type: 'select',
        options: { choices: [{ id: 'c1', label: 'High' }] },
      },
      { id: 'f2', name: 'Who', type: 'user', options: {} },
      { id: 'f3', name: 'Txt', type: 'text', options: {} },
    ];
    expect(groupableFields(defs).map((d) => d.id)).toEqual(['f1', 'f2']);
    expect(choiceNames(defs)).toEqual({ c1: 'High' });
    const m = mount(WidgetBody, {
      props: {
        widget: { id: 'w', kind: 'bars', config: { filter: none, groupBy: 'field:f1' } } as never,
        tasks: [task({ fields: { f1: 'c1' } })],
      },
    });
    expect(m.text()).toContain('High');
  });

  it('pt4: модуль регистрирует маршруты и nav', () => {
    expect(web.id).toBe('dashboards');
    expect(web.routes?.map((r) => r.path)).toEqual(['/m/dashboards/', '/m/dashboards/:id']);
    expect(web.groupTabs?.[0]).toMatchObject({ id: 'boards', tab: 'reports' });
  });
});
