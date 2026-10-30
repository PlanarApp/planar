// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { matchFilter, type Filter, type FilterRule } from '..';
import type { TaskView } from '../../tasks';

const statuses = [
  { id: 's1', category: 'todo' },
  { id: 's2', category: 'done' },
] as never;
const ctx = { statuses, userId: 'me1', today: '2026-10-23' };
const task = (o: Record<string, unknown> = {}) =>
  ({
    statusId: 's1',
    priority: 0,
    dueDate: null,
    title: 'Починить Вход',
    createdBy: 'u9',
    assigneeIds: [],
    labelIds: [],
    ...o,
  }) as unknown as TaskView;
const m = (t: TaskView, ...rules: FilterRule[]) => matchFilter(t, { op: 'and', rules }, ctx);

describe('views:filter', () => {
  it('views:filter in / notIn по статусу, приоритету, метке', () => {
    expect(m(task(), { field: 'status', operator: 'in', value: ['s1'] })).toBe(true);
    expect(m(task(), { field: 'status', operator: 'notIn', value: ['s1'] })).toBe(false);
    expect(m(task({ priority: 2 }), { field: 'priority', operator: 'in', value: [1, 2] })).toBe(
      true,
    );
    expect(m(task(), { field: 'priority', operator: 'in', value: [1] })).toBe(false);
    expect(
      m(task({ labelIds: ['l1'] }), { field: 'label', operator: 'notIn', value: ['l2'] }),
    ).toBe(true);
    expect(m(task(), { field: 'statusCategory', operator: 'in', value: ['todo'] })).toBe(true);
  });
  it('views:filter isEmpty / isNotEmpty для assignee и dueDate', () => {
    const e = (field: 'assignee' | 'dueDate', operator: 'isEmpty' | 'isNotEmpty') =>
      ({ field, operator }) as FilterRule;
    expect(m(task(), e('assignee', 'isEmpty'))).toBe(true);
    expect(m(task({ assigneeIds: ['a'] }), e('assignee', 'isEmpty'))).toBe(false);
    expect(m(task({ assigneeIds: ['a'] }), e('assignee', 'isNotEmpty'))).toBe(true);
    expect(m(task(), e('dueDate', 'isEmpty'))).toBe(true);
    expect(m(task({ dueDate: '2026-10-24' }), e('dueDate', 'isNotEmpty'))).toBe(true);
    expect(m(task({ dueDate: '2026-10-24' }), e('dueDate', 'isEmpty'))).toBe(false);
  });
  it('views:filter before / after с today±N и датой', () => {
    const d = (operator: 'before' | 'after', value: string) =>
      ({ field: 'dueDate', operator, value }) as FilterRule;
    expect(m(task({ dueDate: '2026-10-25' }), d('before', 'today+7'))).toBe(true);
    expect(m(task({ dueDate: '2026-10-30' }), d('before', 'today+7'))).toBe(false); // strictly
    expect(m(task({ dueDate: '2026-10-22' }), d('after', 'today-1'))).toBe(false);
    expect(m(task({ dueDate: '2026-10-23' }), d('after', 'today-1'))).toBe(true);
    expect(m(task({ dueDate: '2026-11-01' }), d('after', '2026-10-31'))).toBe(true);
    expect(m(task(), d('before', 'today'))).toBe(false); // no due date
    expect(m(task({ dueDate: '2026-12-31' }), d('before', 'today+100'))).toBe(true); // month transition
  });
  it('views:filter contains без регистра', () => {
    expect(m(task(), { field: 'title', operator: 'contains', value: 'вход' })).toBe(true);
    expect(m(task(), { field: 'title', operator: 'contains', value: 'выход' })).toBe(false);
  });
  it('views:filter me — текущий пользователь в assignee и createdBy', () => {
    const a: FilterRule = { field: 'assignee', operator: 'in', value: ['me'] };
    expect(m(task({ assigneeIds: ['me1'] }), a)).toBe(true);
    expect(m(task({ assigneeIds: ['x'] }), a)).toBe(false);
    expect(
      m(task({ createdBy: 'me1' }), { field: 'createdBy', operator: 'in', value: ['me'] }),
    ).toBe(true);
  });
  it('views:filter and / or и пустые правила', () => {
    const rules: FilterRule[] = [
      { field: 'title', operator: 'contains', value: 'вход' },
      { field: 'priority', operator: 'in', value: [1] },
    ];
    const f = (op: 'and' | 'or'): Filter => ({ op, rules });
    expect(matchFilter(task(), f('and'), ctx)).toBe(false);
    expect(matchFilter(task(), f('or'), ctx)).toBe(true);
    expect(matchFilter(task(), null, ctx)).toBe(true);
    // an incomplete builder rule doesn't filter out tasks
    expect(m(task(), { field: 'status', operator: 'in', value: [] })).toBe(true);
  });
});
