import { describe, expect, it } from 'vitest';
import type { EngineEventView } from '../shared/index.js';
import { appendEvents, fmtAgo, fmtDuration, sinceOf, statusClass } from './engineUi';

const ev = (id: string) => ({ id }) as EngineEventView;

describe('монитор движков: форматирование', () => {
  it('длительность: секунды, минуты, часы; без конца — до сейчас', () => {
    const s = '2026-11-18T10:00:00.000Z';
    expect(fmtDuration(s, '2026-11-18T10:00:12.300Z')).toBe('12 с');
    expect(fmtDuration(s, '2026-11-18T10:02:05.000Z')).toBe('2 мин 5 с');
    expect(fmtDuration(s, '2026-11-18T10:03:00.000Z')).toBe('3 мин');
    expect(fmtDuration(s, '2026-11-18T11:03:00.000Z')).toBe('1 ч 3 мин');
    expect(fmtDuration(s, null, Date.parse('2026-11-18T10:00:30.000Z'))).toBe('30 с');
  });

  it('давность: только что, минуты, часы, дни; нет — прочерк', () => {
    const now = Date.parse('2026-11-18T10:00:00.000Z');
    expect(fmtAgo(null, now)).toBe('—');
    expect(fmtAgo('2026-11-18T09:59:40.000Z', now)).toBe('только что');
    expect(fmtAgo('2026-11-18T09:55:00.000Z', now)).toBe('5 мин назад');
    expect(fmtAgo('2026-11-18T07:00:00.000Z', now)).toBe('3 ч назад');
    expect(fmtAgo('2026-11-16T10:00:00.000Z', now)).toBe('2 дн назад');
  });

  it('период фильтра истории — начало в ISO', () => {
    const now = Date.parse('2026-11-18T10:00:00.000Z');
    expect(sinceOf('1h', now)).toBe('2026-11-18T09:00:00.000Z');
    expect(sinceOf('7d', now)).toBe('2026-11-11T10:00:00.000Z');
  });

  it('живой лог: новые после старых, без повторов, хвост из max', () => {
    expect(appendEvents([ev('a'), ev('b')], [ev('b'), ev('c')]).map((e) => e.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(appendEvents([ev('a'), ev('b')], [ev('c')], 2).map((e) => e.id)).toEqual(['b', 'c']);
  });

  it('цвет статуса: ошибка и тишина — красные, работа — акцент', () => {
    expect(statusClass('error')).toContain('danger');
    expect(statusClass('stalled')).toContain('danger');
    expect(statusClass('running')).toContain('accent');
    expect(statusClass('idle')).toContain('fg-muted');
  });
});
