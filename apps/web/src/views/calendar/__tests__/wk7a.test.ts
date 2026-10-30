import { describe, expect, it } from 'vitest';
import { monthDays, weekDays } from '../dates';

describe('wk7a: первый день недели', () => {
  it('wk7a: неделя с воскресенья', () => {
    const d = weekDays('2026-10-22', 0);
    expect(d[0]).toBe('2026-10-18');
    expect(d[6]).toBe('2026-10-24');
  });
  it('wk7a: неделя с понедельника по умолчанию', () => {
    expect(weekDays('2026-10-22')[0]).toBe('2026-10-19');
    expect(weekDays('2026-10-25', 1)[0]).toBe('2026-10-19');
  });
  it('wk7a: месяц с воскресенья — целые недели', () => {
    const d = monthDays('2026-10-15', 0); // 1 Oct 2026 — Thursday
    expect(d[0]).toBe('2026-09-27');
    expect(d[34]).toBe('2026-10-31');
    expect(d).toHaveLength(35);
  });
  it('wk7a: воскресенье-якорь при старте с воскресенья — первый день', () => {
    expect(weekDays('2026-10-25', 0)[0]).toBe('2026-10-25');
  });
});
