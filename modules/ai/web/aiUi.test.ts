import { describe, expect, it } from 'vitest';
import type { AiRunView } from '../shared/index.js';
import { canRestart, canStop, mergeRuns, parseLimit, restartDepth, usagePct } from './aiUi';

const run = (id: string, restartOf: string | null = null, state = 'done') =>
  ({ id, restartOf, state }) as AiRunView;

describe('aiUi', () => {
  it('canStop / canRestart по состоянию', () => {
    expect(canStop('running') && canStop('waiting_human')).toBe(true);
    expect(canStop('done') || canStop('failed') || canStop('cancelled')).toBe(false);
    expect(canRestart(run('a', null, 'failed'))).toBe(true);
    expect(canRestart(run('a', null, 'running'))).toBe(false);
  });

  it('restartDepth: длина цепочки перезапусков', () => {
    const a = run('a');
    const b = run('b', 'a');
    const c = run('c', 'b');
    expect(restartDepth([a, b, c], a)).toBe(0);
    expect(restartDepth([a, b, c], c)).toBe(2);
    expect(restartDepth([c], c)).toBe(1); // the rest is not loaded
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
});
