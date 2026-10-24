import { mount } from '@vue/test-utils';

import { describe, expect, it, vi } from 'vitest';
import {
  barOf,
  dayWindow,
  dropArgs,
  fromDay,
  moveArgs,
  newViolations,
  PX,
  resizeArgs,
  rowWindow,
  ticks,
  toDay,
  violates,
} from '../../../../../../modules/timeline/web/lib';

const T = (id: string, startDate: string | null, dueDate: string | null) => ({
  id,
  startDate,
  dueDate,
});

const mutate = vi.hoisted(() => vi.fn(async () => {}));
const N = 10_000;
vi.mock('@planar/web/modules', async () => {
  const { ref } = await import('vue');
  return {
    Button: { template: '<button><slot /></button>' },
    db: {},
    i18n: { global: { locale: ref('ru') } },
    localToday: () => '2026-10-24',
    mutate,
    openTask: vi.fn(),
    useProjectTasks: () =>
      ref(
        Array.from({ length: N }, (_, i) => ({
          id: `t${i}`,
          key: `P-${i}`,
          title: `Задача ${i}`,
          startDate: i % 5 ? '2026-10-20' : null,
          dueDate: i % 5 ? '2026-10-25' : null,
        })),
      ),
    useQuery: () => ref([]),
    useWeekStart: () => ref(1),
  };
});

describe('pt2: полоса по датам', () => {
  it('pt2: обе даты, одна дата, нет дат, начало позже конца', () => {
    expect(barOf(T('a', '2026-10-20', '2026-10-22'))).toEqual({
      s: toDay('2026-10-20'),
      e: toDay('2026-10-22'),
    });
    const one = toDay('2026-10-21');
    expect(barOf(T('a', '2026-10-21', null))).toEqual({ s: one, e: one });
    expect(barOf(T('a', null, '2026-10-21'))).toEqual({ s: one, e: one });
    expect(barOf(T('a', null, null))).toBeNull();
    expect(barOf(T('a', '2026-10-22', '2026-10-20'))).toEqual({
      s: toDay('2026-10-20'),
      e: toDay('2026-10-22'),
    });
  });
});

describe('pt2: перенос и растягивание', () => {
  it('pt2: перенос сдвигает обе даты', () => {
    expect(moveArgs(T('a', '2026-10-30', '2026-11-02'), 3)).toEqual({
      id: 'a',
      startDate: '2026-11-02',
      dueDate: '2026-11-05',
    });
    expect(moveArgs(T('a', null, '2026-10-30'), -1)).toEqual({ id: 'a', dueDate: '2026-10-29' });
  });
  it('pt2: растягивание меняет край, одна дата становится двумя', () => {
    const t = T('a', '2026-10-20', '2026-10-22');
    expect(resizeArgs(t, 'end', toDay('2026-10-25'))).toEqual({
      id: 'a',
      startDate: '2026-10-20',
      dueDate: '2026-10-25',
    });
    expect(resizeArgs(t, 'start', toDay('2026-10-18'))).toMatchObject({ startDate: '2026-10-18' });
    // край не переходит за другой
    expect(resizeArgs(t, 'start', toDay('2026-10-30'))).toMatchObject({
      startDate: '2026-10-22',
      dueDate: '2026-10-22',
    });
    expect(resizeArgs(T('b', null, '2026-10-22'), 'end', toDay('2026-10-24'))).toEqual({
      id: 'b',
      startDate: '2026-10-22',
      dueDate: '2026-10-24',
    });
  });
  it('pt2: из «Без дат» — обе даты, один день', () => {
    expect(dropArgs('a', toDay('2026-10-24'))).toEqual({
      id: 'a',
      startDate: '2026-10-24',
      dueDate: '2026-10-24',
    });
    expect(fromDay(toDay('2026-02-28') + 1)).toBe('2026-03-01');
  });
});

describe('pt2: зависимости', () => {
  const bars = new Map([
    ['A', { s: toDay('2026-10-20'), e: toDay('2026-10-22') }],
    ['B', { s: toDay('2026-10-23'), e: toDay('2026-10-25') }],
  ]);
  const link = { id: 'l', taskId: 'A', targetId: 'B', kind: 'blocks' };
  const get = (id: string) => bars.get(id) ?? null;
  it('pt2: нарушение — начало B <= конец A', () => {
    expect(violates(bars.get('A')!, bars.get('B')!)).toBe(false);
    expect(violates(bars.get('A')!, { s: toDay('2026-10-22'), e: toDay('2026-10-24') })).toBe(true);
    expect(violates(null, bars.get('B')!)).toBe(false);
  });
  it('pt2: перенос, создавший нарушение, — предупреждение; прочие связи и старые нарушения нет', () => {
    const next = { s: toDay('2026-10-22'), e: toDay('2026-10-24') };
    expect(newViolations([link], get, 'B', next)).toEqual([link]);
    expect(newViolations([link], get, 'B', bars.get('B')!)).toEqual([]);
    expect(newViolations([{ ...link, kind: 'relates' }], get, 'B', next)).toEqual([]);
    const bad = new Map(bars).set('B', next);
    expect(newViolations([link], (id) => bad.get(id) ?? null, 'B', next)).toEqual([]);
  });
});

describe('pt2: виртуализация и шкала', () => {
  it('pt2: окно строк мало при любом числе', () => {
    const [a, b] = rowWindow(160_000, 600, N);
    expect(a).toBeGreaterThan(0);
    expect(b - a).toBeLessThanOrEqual(100);
    expect(rowWindow(0, 600, 3)).toEqual([0, 3]);
  });
  it('pt2: окно дней по масштабам', () => {
    for (const s of ['day', 'week', 'month'] as const) {
      const [a, b] = dayWindow(1000, 900, 20000, s);
      expect(a).toBe(20000 + Math.floor(1000 / PX[s]) - 2);
      expect(b).toBeGreaterThan(a);
    }
  });
  it('pt2: метки недели зависят от начала недели, месяца — от 1-го числа', () => {
    const from = toDay('2026-10-19'); // понедельник
    const days = (ws: 0 | 1) =>
      ticks(from, from + 13, 'week', ws).map((k) => new Date(k.day * 86400000).getUTCDay());
    expect(days(1)).toEqual([1, 1]);
    expect(days(0)).toEqual([0, 0]);
    expect(ticks(from, from + 20, 'month', 1).map((k) => k.label)).toEqual(['2026-11']);
    expect(ticks(from, from + 2, 'day', 1)).toHaveLength(3);
  });
  it('pt2: вид с 10 000 задач рисует не более 100 строк', async () => {
    const V = (await import('../../../../../../modules/timeline/web/TimelineView.vue')).default;
    const w = mount(V, { props: { projectId: 'p' } });
    const rows = w.findAll('[role=row]').length;
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThanOrEqual(100);
    expect(w.findAll('[data-testid=tl-undated]').length).toBeLessThanOrEqual(100);
    w.unmount();
  });
});
