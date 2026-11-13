import { describe, expect, it } from 'vitest';
import type { AiRunEvent, AiRunView } from '../shared/index.js';
import {
  canRestart,
  canStop,
  foldOf,
  MAX_LOG_EVENTS,
  mergeEvents,
  mergeRuns,
  parseLimit,
  usagePct,
} from './aiUi';

const run = (id: string, restartOf: string | null = null, state = 'done') =>
  ({ id, restartOf, state }) as AiRunView;

describe('aiUi', () => {
  it('canStop / canRestart по состоянию', () => {
    expect(canStop('running') && canStop('waiting_human')).toBe(true);
    expect(canStop('done') || canStop('failed') || canStop('cancelled')).toBe(false);
    expect(canRestart(run('a', null, 'failed'))).toBe(true);
    expect(canRestart(run('a', null, 'running'))).toBe(false);
  });

  it('usagePct: без лимита и с нулевым — null, выше лимита — 100', () => {
    expect(usagePct(50, null)).toBeNull();
    expect(usagePct(50, 0)).toBeNull();
    expect(usagePct(50, 200)).toBe(25);
    expect(usagePct(500, 200)).toBe(100);
  });

  it('parseLimit: пусто — null, число, мусор и минус — undefined', () => {
    expect(parseLimit(' ')).toBeNull();
    expect(parseLimit('1.5')).toBe(1.5);
    expect(parseLimit('0')).toBe(0);
    expect(parseLimit('-1')).toBeUndefined();
    expect(parseLimit('x')).toBeUndefined();
  });

  it('mergeRuns: дубли по id отбрасываются', () => {
    expect(mergeRuns([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }])).toEqual([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]);
  });

  it('mergeEvents: после курсора, без дублей, только хвост', () => {
    const ev = (id: number) =>
      ({ id, type: 'output', tool: null, text: '', createdAt: '' }) as AiRunEvent;
    expect(mergeEvents([ev(1), ev(2)], [ev(2), ev(3)]).map((e) => e.id)).toEqual([1, 2, 3]);
    const many = Array.from({ length: MAX_LOG_EVENTS }, (_, i) => ev(i + 1));
    const got = mergeEvents(many, [ev(MAX_LOG_EVENTS + 1)]);
    expect(got).toHaveLength(MAX_LOG_EVENTS);
    expect(got[0]!.id).toBe(2);
  });

  it('foldOf: короткий текст целиком, длинный — первые строки', () => {
    expect(foldOf('a\nb')).toBeNull();
    expect(foldOf('1\n2\n3\n4')).toBe('1\n2\n3…');
    expect(foldOf('x'.repeat(400))).toBe(`${'x'.repeat(300)}…`);
  });
});
