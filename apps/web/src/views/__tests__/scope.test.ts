import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import type { Row } from '@planar/shared';
import { groupTasks, type TaskView } from '../../tasks';
import { labelFor, statusFor, statusIn, useLabelKey, useStatusKey, widenByName } from '../scope';

const st = (id: string, spaceId: string, name: string, rank: string) =>
  ({ id, spaceId, name, rank, category: 'todo', color: null }) as unknown as Row<'statuses'>;
const task = (id: string, spaceId: string, statusId: string) =>
  ({ id, spaceId, statusId, assigneeIds: [], labelIds: [] }) as unknown as TaskView;

describe('сводка группы: статусы по имени', () => {
  const statuses = ref([
    st('a1', 'A', 'Готово', 'b'),
    st('a0', 'A', 'К работе', 'a'),
    st('b0', 'B', ' готово ', 'a'),
  ]);

  it('несколько пространств: одноимённые статусы — одна группа; одно пространство — по id', () => {
    const key = useStatusKey({ projectIds: [], spaceIds: ['A', 'B'] }, statuses);
    const tasks = [task('t1', 'A', 'a1'), task('t2', 'B', 'b0'), task('t3', 'A', 'a0')];
    const g = groupTasks(tasks, 'status', {
      statuses: statuses.value,
      members: [],
      labels: [],
      statusKey: key.value,
    });
    expect(g.map((x) => [x.key, x.tasks.map((t) => t.id)])).toEqual([
      ['готово', ['t1', 't2']], // сводка: категория, затем имя (одна категория — по имени)
      ['к работе', ['t3']],
    ]);
    expect(useStatusKey({ projectIds: [], spaceIds: ['A'] }, statuses).value).toBeUndefined();
  });

  it('statusFor: статус пространства задачи по имени группы, нет — undefined', () => {
    expect(statusFor(statuses.value, 'B', 'готово')).toBe('b0');
    expect(statusFor(statuses.value, 'B', 'к работе')).toBeUndefined();
  });
});

describe('PJ-2: сводка проектов одного пространства', () => {
  const s = (id: string, projectId: string, name: string, category: string, rank: string) =>
    ({
      id,
      spaceId: 'S',
      projectId,
      name,
      category,
      rank,
      color: '#000',
    }) as unknown as Row<'statuses'>;
  const l = (id: string, projectId: string, name: string) =>
    ({ id, spaceId: 'S', projectId, name, color: '#000' }) as unknown as Row<'labels'>;
  const statuses = [
    s('p1done', 'P1', 'Готово', 'done', 'a3'),
    s('p1todo', 'P1', 'Сделать', 'todo', 'a2'),
    s('p2done', 'P2', ' готово', 'done', 'a1'),
    s('p2prog', 'P2', 'Аудит', 'in_progress', 'a2'),
  ];
  const labels = [l('l1', 'P1', 'Bug'), l('l2', 'P2', 'bug')];
  const scope = { projectIds: ['P1', 'P2'], spaceIds: ['S'] };
  const tk = (id: string, statusId: string, labelIds: string[] = []) =>
    ({ id, spaceId: 'S', statusId, assigneeIds: [], labelIds }) as unknown as TaskView;

  it('одно имя из двух проектов — одна группа; порядок: категория, затем имя', () => {
    const sk = useStatusKey(scope, ref(statuses)).value;
    const lk = useLabelKey(scope, ref(labels)).value;
    const tasks = [tk('a', 'p1done', ['l1']), tk('b', 'p2done', ['l2']), tk('c', 'p1todo')];
    const ctx = { statuses, members: [], labels, statusKey: sk, labelKey: lk };
    expect(groupTasks(tasks, 'status', ctx).map((g) => [g.key, g.tasks.map((x) => x.id)])).toEqual([
      ['сделать', ['c']],
      ['аудит', []],
      ['готово', ['a', 'b']],
    ]);
    const byLabel = groupTasks(tasks, 'label', ctx);
    expect(byLabel.find((g) => g.key === 'bug')?.tasks.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('один проект — по id', () => {
    expect(
      useStatusKey({ projectIds: ['P1'], spaceIds: ['S'] }, ref(statuses)).value,
    ).toBeUndefined();
  });

  it('statusFor/statusIn/labelFor: статус и метка в проекте задачи по имени', () => {
    expect(statusFor(statuses, 'S', 'готово', 'P2')).toBe('p2done');
    expect(statusIn(statuses, 'P2', 'p1done')).toBe('p2done');
    expect(statusIn(statuses, 'P2', 'p1todo')).toBeUndefined();
    expect(labelFor(labels, 'P2', 'bug')).toBe('l2');
  });

  it('widenByName: правило с id одного проекта ловит одноимённые других; старый формат цел', () => {
    const f = widenByName(
      { op: 'and', rules: [{ field: 'status', operator: 'in', value: ['p1done'] }] },
      statuses,
      labels,
    );
    expect(f.rules[0]!.value).toEqual(['p1done', 'p2done']);
  });
});
