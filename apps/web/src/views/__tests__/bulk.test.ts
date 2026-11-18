import { describe, expect, it } from 'vitest';
import { applyDiff, commonIds, nextTri, triDiff, triStates, type Tri } from '../selection';

describe('PJ-12 массовое назначение', () => {
  it('commonIds: отмечен у всех', () => {
    expect(commonIds([['a', 'b'], ['b', 'c'], ['b']])).toEqual(['b']);
    expect(commonIds([])).toEqual([]);
  });
});

describe('PLNRAPP-498 три состояния исполнителей', () => {
  const m = (o: Record<string, Tri>) => new Map(Object.entries(o));
  it('triStates: у всех, у части; ни у кого — нет в карте', () => {
    expect(triStates([['a', 'b'], ['b']])).toEqual(m({ a: 'some', b: 'all' }));
    expect(triStates([[], []])).toEqual(new Map());
  });
  it('nextTri: из «у части» — по кругу ▣ → ☑ → ☐ → ▣, иначе ☑ ↔ ☐', () => {
    expect(nextTri('some', 'some')).toBe('all');
    expect(nextTri('some', 'all')).toBe('none');
    expect(nextTri('some', 'none')).toBe('some');
    expect(nextTri('all', 'all')).toBe('none');
    expect(nextTri('all', 'none')).toBe('all');
    expect(nextTri('none', 'none')).toBe('all');
    expect(nextTri('none', 'all')).toBe('none');
  });
  it('triDiff: только изменённые строки; нетронутое «у части» не попадает', () => {
    const from = m({ a: 'some', b: 'all', c: 'some' });
    expect(triDiff(from, m({ a: 'all', b: 'none', c: 'some', d: 'all' }))).toEqual({
      add: ['a', 'd'],
      remove: ['b'],
    });
    expect(triDiff(from, from)).toEqual({ add: [], remove: [] });
  });
  it('applyDiff: добавляет без дублей, снимает, остальных не трогает', () => {
    expect(applyDiff(['a', 'c'], ['a', 'b'], ['c'])).toEqual(['a', 'b']);
    expect(applyDiff(['x'], [], [])).toEqual(['x']);
    expect(applyDiff(['a', 'b'], [], ['a', 'b'])).toEqual([]);
  });
});
