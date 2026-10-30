import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../../modules/workload/web/data', async () => {
  const { ref } = await import('vue');
  const t = (id: string, due: string | null, start: string | null = null) => ({
    id,
    statusId: 'st',
    dueDate: due,
    startDate: start,
    title: id,
    number: 1,
    projectId: 'p',
  });
  const data = ref({
    tasks: [t('a', '2026-10-21'), t('b', '2026-10-21')],
    assignees: [
      { taskId: 'a', userId: 'u1' },
      { taskId: 'b', userId: 'u1' },
    ],
    statuses: [{ id: 'st', category: 'todo' }],
    members: [
      { userId: 'u1', role: 'admin' },
      { userId: 'u2', role: 'member' },
    ],
    caps: [] as unknown[],
    projects: [{ id: 'p', key: 'PR' }],
    estimates: [
      { taskId: 'a', minutes: 1500 },
      { taskId: 'b', minutes: 1200 },
    ] as unknown[] | null,
    users: [
      { id: 'u1', name: 'Ann' },
      { id: 'u2', name: 'Bob' },
    ],
  });
  return {
    __data: data,
    mutate: vi.fn(async () => {}),
    newId: () => 'nid',
    openTask: vi.fn(),
    userId: () => 'u1',
    tr: (k: string) => k,
    useSpaces: () => ref([{ id: 's', name: 'S' }]),
    useWeekStart: () => ref(1),
    useWorkloadData: () => data,
  };
});

import * as d from '../../../../../../modules/workload/web/data';
import { web } from '../../../../../../modules/workload/web';
import Page from '../../../../../../modules/workload/web/WorkloadPage.vue';
import { compute, weekList, weekOf } from '../../../../../../modules/workload/web/lib';

const base = {
  doneStatuses: new Set(['done']),
  weekStart: 1 as const,
};
const t = (id: string, due: string | null, start: string | null = null, statusId = 'x') => ({
  id,
  statusId,
  dueDate: due,
  startDate: start,
});
const asg = (taskId: string, ...us: string[]) => us.map((userId) => ({ taskId, userId }));
const est = (m: number) => new Map([['a', m]]);

describe('pt3: подсчёт', () => {
  it('pt3: неделя по weekStart', () => {
    expect(weekOf('2026-10-21', 1)).toBe('2026-10-19');
    expect(weekOf('2026-10-21', 0)).toBe('2026-10-18');
    expect(weekOf('2026-10-18', 1)).toBe('2026-10-12');
    expect(weekList('2026-10-21', 1)).toHaveLength(8);
  });

  it('pt3: оценка делится поровну между исполнителями, без startDate — в неделю dueDate', () => {
    const g = compute({
      ...base,
      tasks: [t('a', '2026-10-21')],
      assignees: asg('a', 'u1', 'u2'),
      estimates: est(240),
    });
    expect(g.get('u1')!.get('2026-10-19')).toEqual({ hours: 2, taskIds: ['a'] });
    expect(g.get('u2')!.get('2026-10-19')!.hours).toBe(2);
  });

  it('pt3: startDate..dueDate делит часы по дням и суммирует по неделям', () => {
    // Sat 17 .. Tue 20: Sat, Sun — week of 12.10; Mon, Tue — week of 19.10; 4 days of 1 h
    const g = compute({
      ...base,
      tasks: [t('a', '2026-10-20', '2026-10-17')],
      assignees: asg('a', 'u1'),
      estimates: est(240),
    });
    expect(g.get('u1')!.get('2026-10-12')!.hours).toBe(2);
    expect(g.get('u1')!.get('2026-10-19')!.hours).toBe(2);
  });

  it('pt3: режим числа задач; done, без dueDate и без исполнителей не считаются', () => {
    const g = compute({
      ...base,
      tasks: [
        t('a', '2026-10-21'),
        t('b', '2026-10-22'),
        t('c', null),
        t('d', '2026-10-22', null, 'done'),
        t('e', '2026-10-22'),
      ],
      assignees: [...asg('a', 'u1'), ...asg('b', 'u1'), ...asg('c', 'u1'), ...asg('d', 'u1')],
    });
    expect(g.get('u1')!.get('2026-10-19')!.taskIds).toEqual(['a', 'b']);
    expect(g.size).toBe(1);
  });

  it('pt3: задача без оценки — 0 ч', () => {
    const g = compute({
      ...base,
      tasks: [t('a', '2026-10-21')],
      assignees: asg('a', 'u1'),
      estimates: new Map(),
    });
    expect(g.get('u1')!.get('2026-10-19')!.hours).toBe(0);
  });
});

describe('pt3: страница', () => {
  it('pt3: manifest — маршрут и nav под /m/workload', () => {
    expect(web.id).toBe('workload');
    expect(web.groupTabs![0]).toMatchObject({ id: 'page', tab: 'reports' });
  });

  it('pt3: перегрузка подсвечена, клик открывает список, ёмкость правится админом', async () => {
    // 25 h + 20 h = 45 > 40 in the page's current week — substitute the dates of the "today" week
    const st = (d as unknown as { __data: { value: any } }).__data; // eslint-disable-line @typescript-eslint/no-explicit-any
    const due = new Date().toISOString().slice(0, 10);
    for (const x of st.value.tasks) x.dueDate = due;
    const w = weekOf(due, 1);
    const wrap = mount(Page);
    await wrap.vm.$nextTick();
    const cell = wrap.get(`[data-test="cell-u1-${w}"]`);
    expect(cell.text()).toBe('45');
    expect(cell.element.parentElement!.classList.contains('over')).toBe(true);
    await cell.trigger('click');
    await wrap.get('[data-test="task"]').trigger('click');
    expect(d.openTask).toHaveBeenCalledWith('PR-1');
    await wrap.get('[data-test="cap-u2"]').setValue('0');
    await wrap.get('[data-test="cap-u2"]').trigger('change');
    expect(d.mutate).toHaveBeenCalledWith('workload.setCapacity', {
      id: 'nid',
      spaceId: 's',
      userId: 'u2',
      hoursPerWeek: 0,
    });
  });

  it('pt3: без модуля time — только число задач', async () => {
    const st = (d as unknown as { __data: { value: any } }).__data; // eslint-disable-line @typescript-eslint/no-explicit-any
    st.value.estimates = null;
    const wrap = mount(Page);
    await wrap.vm.$nextTick();
    expect(wrap.find('[data-test="mode"]').exists()).toBe(false);
    expect(wrap.findAll('.over')).toHaveLength(0);
  });
});
