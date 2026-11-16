import { describe, expect, it } from 'vitest';
import { formatDue, formatPeriod } from '../due';

const now = new Date(2026, 9, 24);
describe('formatDue', () => {
  it('без года в текущем', () => {
    expect(formatDue('2026-03-08', 'ru', now)).toBe('8 мар.');
    expect(formatDue('2026-03-08', 'en', now)).toBe('Mar 8');
  });
  it('с годом в другом', () => {
    expect(formatDue('2025-03-08', 'ru', now)).toContain('2025');
    expect(formatDue('2027-03-08', 'en', now)).toBe('Mar 8, 2027');
  });
  it('не сдвигается по UTC', () => {
    expect(formatDue('2026-01-01', 'en', now)).toBe('Jan 1');
  });
});

describe('formatPeriod', () => {
  it('один месяц — «12–19 нояб.»', () => {
    expect(formatPeriod('2026-11-12', '2026-11-19', 'ru', now)).toBe('12–19 нояб.');
    expect(formatPeriod('2026-11-12', '2026-11-19', 'en', now)).toMatch(/^Nov 12\s–\s19$/);
  });
  it('разные месяцы и годы', () => {
    expect(formatPeriod('2026-11-12', '2026-12-03', 'ru', now)).toBe('12 нояб. – 3 дек.');
    expect(formatPeriod('2026-12-30', '2027-01-02', 'ru', now)).toBe('30 дек. 2026 – 2 янв. 2027');
  });
  it('одна дата или конец раньше начала', () => {
    expect(formatPeriod('2026-11-12', '2026-11-12', 'ru', now)).toBe('12 нояб.');
    expect(formatPeriod(null, '2026-11-20', 'ru', now)).toBe('20 нояб.');
    expect(formatPeriod(null, null, 'ru', now)).toBe('');
    expect(formatPeriod('2026-11-20', '2026-11-12', 'ru', now)).toBe('20 нояб. – 12 нояб.');
  });
});
