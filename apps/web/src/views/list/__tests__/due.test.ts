import { describe, expect, it } from 'vitest';
import { dueKind, dueTone, formatDue } from '../due';

const now = new Date(2026, 9, 24);
describe('formatDue', () => {
  it('без года в текущем', () => {
    expect(formatDue('2026-03-08', 'ru', now)).toBe('8 мар.');
    // "авг." keeps its "г." — only the year suffix is cut
    expect(formatDue('2026-08-21', 'ru', now)).toBe('21 авг.');
    expect(formatDue('2025-08-21', 'ru', now)).toBe('21 авг. 2025');
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

describe('dueKind / dueTone (PLNRAPP-872)', () => {
  it('прошлое — красным, сегодня — зелёным, будущее — цветом текста', () => {
    expect(dueKind('2026-10-23', now)).toBe('overdue');
    expect(dueKind('2026-10-24', now)).toBe('today');
    expect(dueKind('2026-10-25', now)).toBe('future');
    expect(dueTone('2026-10-23', now)).toBe('text-due-overdue');
    expect(dueTone('2026-10-24', now)).toBe('text-due-today');
    expect(dueTone('2026-10-25', now)).toBe('text-due-future');
    expect(dueTone(null, now)).toBe('');
  });
});
