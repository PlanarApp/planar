import { mount as vmount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { TooltipProvider } from 'reka-ui';
import { i18n } from '../../../i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../../modules/time/web/data', async () => {
  const { ref } = await import('vue');
  const state = {
    entries: ref<unknown[]>([]),
    taskEntries: ref<unknown[]>([]),
    tasks: ref<unknown[]>([]),
    estimate: ref<unknown>(undefined),
    now: ref(Date.parse('2026-10-21T12:00:00Z')),
    weekStart: ref<0 | 1>(1),
  };
  let n = 0;
  return {
    __state: state,
    mutate: vi.fn(async () => {}),
    openTask: vi.fn(),
    newId: () => `id-${++n}`,
    userId: () => 'me',
    tr: (k: string) => k,
    locale: () => 'en',
    useMyEntries: () => state.entries,
    useEntries: () => state.entries,
    useTaskEntries: () => state.taskEntries,
    loadExport: vi.fn(),
    useUserNames: () =>
      ref(
        new Map([
          ['me', 'Я'],
          ['someone', 'Коллега'],
        ]),
      ),
    useUsers: () => ref([]),
    isInstanceAdmin: () => false,
    useTasks: () => state.tasks,
    useEstimate: () => state.estimate,
    useNow: () => state.now,
    useWeekStart: () => state.weekStart,
  };
});

import * as data from '../../../../../../modules/time/web/data';
import { web } from '../../../../../../modules/time/web';
import TimerPanel from '../../../../../../modules/time/web/TimerPanel.vue';
import TimeControl from '../../../../../../modules/time/web/TimeControl.vue';
import TopbarTimer from '../../../../../../modules/time/web/TopbarTimer.vue';
import WeekPage from '../../../../../../modules/time/web/WeekPage.vue';
import {
  dayKey,
  exportRows,
  parseHm,
  planCell,
  toCsv,
  weekDays,
} from '../../../../../../modules/time/web/lib';
import { registerModules } from '../../registry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const st = (data as unknown as { __state: Record<string, { value: any }> }).__state;
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

// IconButton/Menu require TooltipProvider (App.vue provides it) and i18n
const mount = (c: object, o: { props?: Record<string, unknown> } = {}) =>
  vmount(defineComponent({ render: () => h(TooltipProvider, () => h(c, o.props)) }), {
    global: { plugins: [i18n] },
  });

beforeEach(() => {
  mutate.mockClear();
  st.entries.value = [];
  st.taskEntries.value = [];
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
      entry({ taskId: 'kid', userId: 'someone' }), // someone else's — not counted
      entry({ taskId: 'other' }), // not from the subtree
      entry({
        taskId: 'kid',
        startedAt: new Date(NOW - 600_000).toISOString(),
        endedAt: null,
        durationSec: null,
      }), // runs 10 min
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

describe('PLNRAPP-149 экспорт CSV', () => {
  const data = {
    tasks: [{ id: 'root', title: 'Корень', projectId: 'p' }],
    projects: [{ id: 'p', name: 'APP' }],
    users: [
      { id: 'me', name: 'Я', login: 'me' },
      { id: 'someone', name: 'Коллега', login: 'colleague' },
    ],
  };

  it('строки: дата со временем, проект, задача, имя, логин, минуты, коммент, billed; период, область, без идущих', () => {
    const rows = exportRows(
      {
        ...data,
        entries: [
          entry({
            startedAt: new Date(2026, 9, 21, 9, 5, 7).toISOString(),
            durationSec: 5430,
            note: 'x',
            billable: true,
          }),
          entry({
            userId: 'someone',
            startedAt: new Date(2026, 9, 20, 18, 30).toISOString(),
            durationSec: 600,
          }),
          entry({ startedAt: '2026-10-25T12:00:00.000Z' }), // after the period
          entry({ taskId: 'other', startedAt: '2026-10-21T12:00:00.000Z' }), // out of scope
          entry({ startedAt: '2026-10-21T12:00:00.000Z', endedAt: null, durationSec: null }), // running
        ],
      },
      '2026-10-19',
      '2026-10-22',
      (id) => id === 'root',
    );
    expect(rows).toEqual([
      ['2026-10-20 18:30:00', 'APP', 'Корень', 'Коллега', 'colleague', '10', '', '0'],
      ['2026-10-21 09:05:07', 'APP', 'Корень', 'Я', 'me', '91', 'x', '1'],
    ]);
  });

  it('CSV: BOM, CRLF, кавычки; формулы обезврежены', () => {
    expect(
      toCsv([
        ['a', 'b,c', 'say "hi"'],
        ['=1+1', '-x', 'ok\nline'],
      ]),
    ).toBe('﻿a,"b,c","say ""hi"""\r\n\'=1+1,\'-x,"ok\nline"\r\n');
  });
});

describe('PLNRAPP-145 диалог времени', () => {
  it('формат Xm|h|d|w (1d = 8h, 1w = 5d), прежние «1:30» и «1.5» тоже', () => {
    expect(parseHm('30m')).toBe(1800);
    expect(parseHm('2h')).toBe(7200);
    expect(parseHm('1h 30m')).toBe(5400);
    expect(parseHm('1,5H')).toBe(5400);
    expect(parseHm('1d')).toBe(8 * 3600);
    expect(parseHm('1w 1d')).toBe(48 * 3600);
    expect(parseHm('1:30')).toBe(5400);
    expect(parseHm('1.5')).toBe(5400);
    expect(parseHm('')).toBe(0);
    for (const bad of ['1x', 'h', '1h abc', '2 3h']) expect(parseHm(bad)).toBeNull();
  });

  it('фокус в поле времени, время слева от даты, заметка и «Оплачиваемое» уходят в time.log', async () => {
    const w = vmount(TimerPanel, {
      props: { taskId: 'root', menu: true },
      attachTo: document.body,
      global: { plugins: [i18n], stubs: { Menu: true } },
    });
    const dur = w.get('[data-test=dur]');
    expect(document.activeElement).toBe(dur.element);
    expect(dur.element.compareDocumentPosition(w.get('[data-test=day]').element)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(w.get('[data-test=note]').attributes('maxlength')).toBe('200');
    expect(w.text()).not.toContain('entries');
    await dur.setValue('45m');
    await w.get('[data-test=note]').setValue('созвон');
    await w.get('[data-test=billable]').setValue(true);
    await w.get('form').trigger('submit');
    expect(mutate).toHaveBeenCalledWith(
      'time.log',
      expect.objectContaining({ durationSec: 2700, note: 'созвон', billable: true }),
    );
    w.unmount();
  });

  it('записи всех исполнителей: имя, отметка оплаты, хинт заметки; меню только у своих', async () => {
    st.taskEntries.value = [
      entry({ id: 'mine', billable: true, note: 'ревью', startedAt: '2026-10-20T08:00:00.000Z' }),
      entry({ id: 'theirs', userId: 'someone', billable: false }),
    ];
    const w = mount(TimerPanel, { props: { taskId: 'root', menu: true } });
    const rows = w.findAll('[data-test=entry]');
    expect(rows.map((r) => r.get('[data-test=entry-user]').text())).toEqual(['Коллега', 'Я']);
    expect(rows[1].get('[data-test=entry-note]').attributes('title')).toBe('ревью');
    expect(rows[1].find('[data-test=entry-billable]').exists()).toBe(true);
    expect(rows[0].find('[data-test=entry-billable]').exists()).toBe(false);
    // the menu (edit/delete) — only on own entries
    expect(rows[0].find('button').exists()).toBe(false);
    expect(rows[1].find('button').exists()).toBe(true);
  });
});

describe('PLANARAPP-42 свойство «Время»', () => {
  it('старт/стоп слева, справа — затреканное по задаче; клик по времени — меню с формой', async () => {
    const w = mount(TimeControl, { props: { taskId: 'root' } });
    // PLNRAPP-128: no time yet — «+» with the label
    expect(w.get('[data-test=time-total]').text()).toBe('');
    expect(w.get('[data-test=time-total]').attributes('aria-label')).toBe('addManual');
    await w.get('[data-test=time-toggle]').trigger('click');
    expect(mutate).toHaveBeenCalledWith('time.start', { id: expect.any(String), taskId: 'root' });
    st.entries.value = [
      entry({ durationSec: 3600 }),
      entry({ taskId: 'kid', durationSec: 1800 }), // a subtask — not on the property
    ];
    await w.vm.$nextTick();
    expect(w.get('[data-test=time-total]').text()).toBe('1:00');
    st.entries.value = [
      entry({
        id: 'run',
        startedAt: new Date(NOW - 65_000).toISOString(),
        endedAt: null,
        durationSec: null,
      }),
    ];
    await w.vm.$nextTick();
    expect(w.get('[data-test=time-total]').text()).toBe('1:05'); // running: m:ss
    await w.get('[data-test=time-toggle]').trigger('click');
    expect(mutate).toHaveBeenLastCalledWith('time.stop', { id: 'run' });
    expect(web.taskPanels?.[0]).toMatchObject({ id: 'timer', property: true });
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
    // PLNRAPP-125: the title is a separate target — it opens the task and does not stop the timer
    const name = w.get('[data-test=topbar-timer-task]');
    expect(name.text()).toContain('Подзадача');
    await name.trigger('click');
    expect(data.openTask).toHaveBeenCalledWith('kid');
    expect(mutate).not.toHaveBeenCalledWith('time.stop', { id: 'run' });
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
    await cell.setValue('2:30'); // setValue in happy-dom fires change itself
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
    expect(web.groupTabs?.[0]).toMatchObject({ id: 'week', tab: 'reports' });
    expect(web.taskPanels?.[0].id).toBe('timer');
    expect(web.topbar?.[0].id).toBe('timer');
  });
});
