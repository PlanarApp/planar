import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import type { Row } from '@planar/shared';
import { groupTasks, type TaskView } from '../../tasks';
import { statusFor, useStatusKey } from '../scope';

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
      ['к работе', ['t3']],
      ['готово', ['t1', 't2']],
    ]);
    expect(useStatusKey({ projectIds: [], spaceIds: ['A'] }, statuses).value).toBeUndefined();
  });

  it('statusFor: статус пространства задачи по имени группы, нет — undefined', () => {
    expect(statusFor(statuses.value, 'B', 'готово')).toBe('b0');
    expect(statusFor(statuses.value, 'B', 'к работе')).toBeUndefined();
  });
});
