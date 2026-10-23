import 'fake-indexeddb/auto';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { domainMutators } from '@planar/shared';
import en from '../../../i18n/en';
import ru from '../../../i18n/ru';
import { db, registerMutators, startSync, stopSync } from '../../../sync';
import { ids, reset, task, until } from '../../../tasks/__tests__/data';
import { resetBreakpoint } from '../../../ui';
import { localToday } from '../../filter';
import View from '../View.vue';
import { addDays, layout, monthDays, shift, weekDays } from '../dates';

vi.mock('../..', async (orig) => ({ ...(await orig<object>()), openTask: vi.fn() }));

const i18n = createI18n({
  legacy: false,
  locale: 'ru',
  fallbackLocale: 'ru',
  messages: { ru, en },
});
const options = {
  groupBy: 'status' as const,
  sortBy: 'rank' as const,
  sortDir: 'asc' as const,
  showSubtasks: false,
  fields: ['status'] as never,
};
const t = (id: string, startDate: string | null, dueDate: string | null) => ({
  id,
  startDate,
  dueDate,
});

beforeAll(() => registerMutators(domainMutators));
beforeEach(async () => {
  localStorage.clear();
  await stopSync();
  await reset();
  await startSync({
    userId: ids.ann,
    fetch: (() => Promise.reject(new TypeError('offline'))) as never,
  });
  await db._queue.clear();
});
afterEach(() => {
  vi.useRealTimers();
  resetBreakpoint();
});
const mq = (matches: boolean) => {
  window.matchMedia = vi.fn().mockReturnValue({ matches, addEventListener() {} }) as never;
  resetBreakpoint();
};
const mountView = () =>
  mount(View, { props: { projectId: ids.project, options }, global: { plugins: [i18n] } });

describe('calendar:dates', () => {
  it('calendar: сетка месяца — целые недели с понедельника', () => {
    const d = monthDays('2026-10-15'); // 1 окт 2026 — четверг, 31 — суббота
    expect(d).toHaveLength(35);
    expect(d[0]).toBe('2026-09-28');
    expect(d[34]).toBe('2026-11-01');
    expect(monthDays('2026-02-10')).toHaveLength(35); // 1 фев 2026 — воскресенье, неделя с 26 янв
  });
  it('calendar: неделя — с понедельника по воскресенье', () => {
    expect(weekDays('2026-10-22')).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
  });
  it('calendar: раскладка диапазона start..due включительно', () => {
    const m = layout([t('a', '2026-10-20', '2026-10-22')], weekDays('2026-10-21'));
    expect([...m].filter(([, l]) => l.length).map(([d]) => d)).toEqual([
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
    ]);
  });
  it('calendar: одна дата — один день', () => {
    const days = weekDays('2026-10-21');
    for (const x of [t('a', null, '2026-10-21'), t('a', '2026-10-21', null)])
      expect([...layout([x], days)].filter(([, l]) => l.length).map(([d]) => d)).toEqual([
        '2026-10-21',
      ]);
  });
  it('calendar: без дат — нигде в сетке', () => {
    expect([...layout([t('a', null, null)], monthDays('2026-10-01')).values()].flat()).toEqual([]);
  });
  it('calendar: перенос сохраняет длительность через границу месяца', () => {
    expect(shift(t('a', '2026-10-30', '2026-11-02'), '2026-10-30', '2026-12-30')).toEqual({
      startDate: '2026-12-30',
      dueDate: '2027-01-02',
    });
    expect(shift(t('a', null, '2026-03-28'), '2026-03-28', '2026-03-30')).toEqual({
      dueDate: '2026-03-30',
    });
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30'); // переход на летнее время
  });
  it('calendar: из боковой колонки ставит dueDate', () => {
    expect(shift(t('a', null, null), null, '2026-10-25')).toEqual({ dueDate: '2026-10-25' });
  });
  it('calendar: «сегодня» — локальная дата около полуночи', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 23, 0, 30));
    expect(localToday()).toBe('2026-10-23');
    vi.setSystemTime(new Date(2026, 9, 23, 23, 30));
    expect(localToday()).toBe('2026-10-23');
  });
});

describe('calendar:view', () => {
  it('calendar: перенос вызывает одну мутацию с нужными датами', async () => {
    mq(false);
    const today = localToday();
    const target = addDays(today, 1);
    const x = task(1, { startDate: today, dueDate: today });
    const un = task(2);
    await db.table('tasks').bulkPut([x, un]);
    const w = mountView();
    await until(() => w.find(`[data-day="${today}"] [data-task="${x.id}"]`).exists());
    await until(() => w.find(`[data-test="undated"] [data-task="${un.id}"]`).exists());
    const before = await db._queue.count();
    await w.find(`[data-day="${today}"] [data-task="${x.id}"]`).trigger('dragstart');
    await w.find(`[data-day="${target}"]`).trigger('drop');
    await flushPromises();
    const row = await db.table('tasks').get(x.id);
    expect([row.startDate, row.dueDate]).toEqual([target, target]);
    expect(await db._queue.count()).toBe(before + 1);

    await w.find(`[data-test="undated"] [data-task="${un.id}"]`).trigger('dragstart');
    await w.find(`[data-day="${target}"]`).trigger('drop');
    await flushPromises();
    expect((await db.table('tasks').get(un.id)).dueDate).toBe(target);
  });
  it('calendar: mobile — список по дням без сетки', async () => {
    mq(true);
    const today = localToday();
    await db.table('tasks').put(task(1, { dueDate: today }));
    const w = mountView();
    await until(() => w.find('[data-test="agenda"] section').exists());
    expect(w.find('[data-test="grid"]').exists()).toBe(false);
    expect(w.text()).toContain('t1');
  });
});
