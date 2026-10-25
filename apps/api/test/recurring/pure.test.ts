import { describe, expect, it } from 'vitest';
import {
  addMonths,
  afterDoneDue,
  duePeriod,
  nextOccurrence,
  todayIn,
  type Schedule,
} from '@planar/module-recurring/shared';

const sch = (o: Partial<Schedule>): Schedule => ({
  kind: 'interval',
  every: 1,
  unit: 'day',
  weekdays: [],
  anchorDate: '2026-01-05',
  ...o,
});

describe('pf1: nextOccurrence', () => {
  it('pf1: 31-е число — месяц без 31 даёт последний день и возвращается на 31', () => {
    const r = sch({ unit: 'month', anchorDate: '2026-01-31' });
    expect(nextOccurrence(r, '2026-01-31')).toBe('2026-02-28');
    expect(nextOccurrence(r, '2026-02-28')).toBe('2026-03-31');
    expect(nextOccurrence(r, '2026-03-31')).toBe('2026-04-30');
    expect(
      nextOccurrence(sch({ unit: 'month', every: 2, anchorDate: '2026-01-31' }), '2026-01-31'),
    ).toBe('2026-03-31');
  });

  it('pf1: високосный год', () => {
    const r = sch({ unit: 'month', anchorDate: '2028-01-31' });
    expect(nextOccurrence(r, '2028-01-31')).toBe('2028-02-29');
    expect(addMonths('2028-02-29', 12)).toBe('2029-02-28');
    expect(nextOccurrence(sch({ anchorDate: '2028-02-28' }), '2028-02-28')).toBe('2028-02-29');
    expect(nextOccurrence(sch({ anchorDate: '2028-02-28' }), '2028-02-29')).toBe('2028-03-01');
  });

  it('pf1: day/week — шаг от anchorDate, строго после after, до anchor — сам anchor', () => {
    expect(nextOccurrence(sch({ every: 3 }), '2026-01-05')).toBe('2026-01-08');
    expect(nextOccurrence(sch({ every: 3 }), '2026-01-07')).toBe('2026-01-08');
    expect(nextOccurrence(sch({ every: 3 }), '2026-01-08')).toBe('2026-01-11');
    expect(nextOccurrence(sch({ every: 3 }), '2025-12-01')).toBe('2026-01-05');
    expect(nextOccurrence(sch({ unit: 'week', every: 2 }), '2026-01-05')).toBe('2026-01-19');
  });

  it('pf1: weekdays через неделю', () => {
    // anchor — понедельник 2026-01-05; вт и чт каждые 2 недели
    const r = sch({ kind: 'weekdays', unit: 'week', every: 2, weekdays: [2, 4] });
    expect(nextOccurrence(r, '2026-01-04')).toBe('2026-01-06');
    expect(nextOccurrence(r, '2026-01-06')).toBe('2026-01-08');
    expect(nextOccurrence(r, '2026-01-08')).toBe('2026-01-20'); // неделя 2026-01-12 пропущена
    expect(nextOccurrence(r, '2026-01-20')).toBe('2026-01-22');
  });

  it('pf1: weekdays — воскресенье принадлежит неделе, начатой в понедельник', () => {
    const r = sch({ kind: 'weekdays', unit: 'week', every: 2, weekdays: [0, 1] });
    // 2026-01-11 — вс первой недели
    expect(nextOccurrence(r, '2026-01-05')).toBe('2026-01-11');
    expect(nextOccurrence(r, '2026-01-11')).toBe('2026-01-19');
  });
});

describe('pf1: duePeriod и afterDoneDue', () => {
  const r = { ...sch({ every: 7 }), nextDate: '2026-01-12' };

  it('pf1: duePeriod — не наступил → null, пропущенные не догоняются', () => {
    expect(duePeriod(r, '2026-01-11', 0)).toBeNull();
    expect(duePeriod(r, '2026-01-12', 0)).toBe('2026-01-12');
    expect(duePeriod(r, '2026-02-03', 0)).toBe('2026-02-02');
  });

  it('pf1: duePeriod — span создаёт экземпляр заранее', () => {
    expect(duePeriod(r, '2026-01-09', 3)).toBe('2026-01-12');
    expect(duePeriod(r, '2026-01-08', 3)).toBeNull();
    expect(duePeriod({ ...r, kind: 'after_done' }, '2030-01-01', 0)).toBeNull();
  });

  it('pf1: afterDoneDue', () => {
    expect(afterDoneDue({ every: 10, unit: 'day' }, '2026-02-25')).toBe('2026-03-07');
    expect(afterDoneDue({ every: 2, unit: 'week' }, '2026-02-25')).toBe('2026-03-11');
    expect(afterDoneDue({ every: 1, unit: 'month' }, '2026-01-31')).toBe('2026-02-28');
  });

  it('pf1: граница суток UTC и Europe/Moscow, неверный пояс бросает', () => {
    const at = new Date('2026-10-24T21:30:00Z');
    expect(todayIn('UTC', at)).toBe('2026-10-24');
    expect(todayIn('Europe/Moscow', at)).toBe('2026-10-25');
    expect(() => todayIn('Mars/Base', at)).toThrow();
  });
});
