import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

vi.mock('../../../../../../modules/time/web/data', async () => {
  const { ref } = await import('vue');
  const state = {
    entries: ref<unknown[]>([]),
    tasks: ref<unknown[]>([]),
    estimate: ref<unknown>(undefined),
    now: ref(Date.parse('2026-10-21T12:00:00Z')),
    weekStart: ref<0 | 1>(1),
  };
  let n = 0;
  return {
    __state: state,
    mutate: vi.fn(async () => {}),
    newId: () => `id-${++n}`,
    userId: () => 'me',
    tr: (k: string) => k,
    locale: () => 'en',
    useMyEntries: () => state.entries,
    useTasks: () => state.tasks,
    useEstimate: () => state.estimate,
    useNow: () => state.now,
    useWeekStart: () => state.weekStart,
  };
});

import * as data from '../../../../../../modules/time/web/data';
import { web } from '../../../../../../modules/time/web';
import TimerPanel from '../../../../../../modules/time/web/TimerPanel.vue';
import TopbarTimer from '../../../../../../modules/time/web/TopbarTimer.vue';
import WeekPage from '../../../../../../modules/time/web/WeekPage.vue';
import { dayKey, planCell, weekDays } from '../../../../../../modules/time/web/lib';
import { registerModules } from '../../registry';

const st = (data as unknown as { __state: Record<string, ReturnType<typeof ref<never>>> }).__state;
const mutate = data.mutate as unknown as ReturnType<typeof vi.fn>;

const NOW = Date.parse('2026-10-21T12:00:00Z');
const entry = (o: Record<string, unknown>) => ({
  id: 'e' + Math.random(),
  spaceId: 's',
  taskId: 'root',
  userId: 'me',
  startedAt: '2026-10-21T08:00:00.000Z',
  endedAt: '2026-10-21T09:00:00.000Z',
  durationSec: 3600,
  note: null,
  source: 'manual',
  createdAt: '',
  updatedAt: '',
  ...o,
});

beforeEach(() => {
  mutate.mockClear();
  st.entries.value = [];
  st.estimate.value = undefined;
  st.now.value = NOW;
  st.weekStart.value = 1;
  st.tasks.value = [
    { id: 'root', parentId: null, title: 'Корень' },
    { id: 'kid', parentId: 'root', title: 'Подзадача' },
    { id: 'grand', parentId: 'kid', title: 'Внук' },
    { id: 'other', parentId: null, title: 'Чужая' },
  ];
});

describe('wk1: панель задачи', () => {
  it('wk1: сумма — свои записи задачи и подзадач (рекурсивно) плюс идущий таймер', () => {
    st.entries.value = [
      entry({ taskId: 'root' }), // 1:00
      entry({ taskId: 'grand', durationSec: 1800 }), // 0:30
      entry({ taskId: 'kid', userId: 'someone' }), // чужая — не считается
      entry({ taskId: 'other' }), // не из поддерева
      entry({
        taskId: 'kid',
        startedAt: new Date(NOW - 600_000).toISOString(),
        endedAt: null,
        durationSec: null,
      }), // идёт 10 мин
    ];
    const w = mount(TimerPanel, { props: { taskId: 'root' } });
    expect(w.get('[data-test=sum]').text()).toContain('1:40');
  });

  it('wk1: оценка против факта', async () => {
    st.entries.value = [entry({ durationSec: 3600 })];
    st.estimate.value = { id: 'root', minutes: 120 };
    const w = mount(TimerPanel, { props: { taskId: 'root' } });
    expect(w.get('[data-test=vs]').text()).toBe('50%');
    await w.get('[data-test=estimate]').setValue('3:00');
    await w.get('[data-test=estimate]').trigger('change');
    expect(mutate).toHaveBeenCalledWith('time.setEstimate', { taskId: 'root', minutes: 180 });
    await w.get('[data-test=estimate]').setValue('');
    await w.get('[data-test=estimate]').trigger('change');
    expect(mutate).toHaveBeenLastCalledWith('time.setEstimate', { taskId: 'root', minutes: null });
  });

  it('wk1: кнопка вызывает time.start, а при идущем таймере задачи — time.stop', async () => {
    const w = mount(TimerPanel, { props: { taskId: 'root' } });
    await w.get('[data-test=toggle]').trigger('click');
    expect(mutate).toHaveBeenCalledWith('time.start', { id: 'id-1', taskId: 'root' });
    st.entries.value = [entry({ id: 'run', endedAt: null, durationSec: null })];
    await w.vm.$nextTick();
    await w.get('[data-test=toggle]').trigger('click');
    expect(mutate).toHaveBeenLastCalledWith('time.stop', { id: 'run' });
  });

  it('wk1: ручная запись — time.log с длительностью', async () => {
    const w = mount(TimerPanel, { props: { taskId: 'root' } });
    await w.get('[data-test=dur]').setValue('1:30');
    await w.get('form').trigger('submit');
    expect(mutate).toHaveBeenCalledWith(
      'time.log',
      expect.objectContaining({ taskId: 'root', durationSec: 5400 }),
    );
  });
});

describe('wk1: верхняя панель', () => {
  it('wk1: скрыта без таймера, при идущем показывает время и останавливает', async () => {
    const w = mount(TopbarTimer);
    expect(w.find('[data-test=topbar-timer]').exists()).toBe(false);
    st.entries.value = [
      entry({
        id: 'run',
        taskId: 'kid',
        startedAt: new Date(NOW - 65_000).toISOString(),
        endedAt: null,
        durationSec: null,
      }),
    ];
    await w.vm.$nextTick();
    const b = w.get('[data-test=topbar-timer]');
    expect(b.text()).toContain('1:05');
    expect(b.text()).toContain('Подзадача');
    await b.trigger('click');
    expect(mutate).toHaveBeenCalledWith('time.stop', { id: 'run' });
  });
});

describe('wk1: неделя «Мои часы»', () => {
  const today = dayKey(new Date());
  const startedToday = () => {
    const [y, m, d] = today.split('-').map(Number);
    return new Date(y, m - 1, d, 10).toISOString();
  };

  it('wk1: неделя начинается с понедельника или воскресенья по useWeekStart', () => {
    const wed = new Date(2026, 9, 21);
    expect(weekDays(wed, 1)[0].getDay()).toBe(1);
    expect(weekDays(wed, 0)[0].getDay()).toBe(0);
    expect(weekDays(wed, 0).map(dayKey)[0]).toBe('2026-10-18');
    st.weekStart.value = 0;
    const w = mount(WeekPage);
    expect(w.findAll('[data-test=day]')).toHaveLength(7);
    expect(w.findAll('[data-test=day]')[0].text()).toMatch(/^Sun/);
  });

  it('wk1: правка ячейки вверх — time.log на разницу', async () => {
    st.entries.value = [
      entry({ startedAt: startedToday(), endedAt: startedToday(), durationSec: 3600 }),
    ];
    const w = mount(WeekPage);
    const cell = w.get(`[data-test=cell-root-${today}]`);
    expect((cell.element as HTMLInputElement).value).toBe('1:00');
    await cell.setValue('2:30'); // setValue в happy-dom сам шлёт change
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(
      'time.log',
      expect.objectContaining({ taskId: 'root', durationSec: 5400 }),
    );
  });

  it('wk1: правка вниз укорачивает/удаляет ручные записи, 0 удаляет записи дня', () => {
    const a = entry({ id: 'a', startedAt: '2026-10-21T07:00:00.000Z', durationSec: 3600 });
    const b = entry({ id: 'b', startedAt: '2026-10-21T09:00:00.000Z', durationSec: 1800 });
    const t = (sec: number) =>
      planCell([a, b] as never, sec, '2026-10-21T06:00:00.000Z', () => 'n', 'root');
    expect(t(3600)).toEqual([{ name: 'time.delete', args: { id: 'b' } }]);
    expect(t(4500)).toEqual([{ name: 'time.update', args: { id: 'b', durationSec: 900 } }]);
    expect(t(1200)).toEqual([
      { name: 'time.delete', args: { id: 'b' } },
      { name: 'time.update', args: { id: 'a', durationSec: 1200 } },
    ]);
    expect(
      t(0)
        .map((o) => o.args.id)
        .sort(),
    ).toEqual(['a', 'b']);
    expect(t(5400)).toEqual([]);
  });
});

describe('wk1: манифест', () => {
  it('wk1: registerModules принимает time (route, nav, topbar, taskPanels)', () => {
    expect(() => registerModules([web])).not.toThrow();
    expect(web.nav?.[0]).toMatchObject({ id: 'week', to: '/m/time/week' });
    expect(web.taskPanels?.[0].id).toBe('timer');
    expect(web.topbar?.[0].id).toBe('timer');
  });
});
