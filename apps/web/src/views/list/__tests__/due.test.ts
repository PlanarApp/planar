import { describe, expect, it } from 'vitest';
import { formatDue } from '../due';

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
