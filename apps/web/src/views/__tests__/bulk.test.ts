import { describe, expect, it } from 'vitest';
import { applyToggle, commonIds } from '../selection';

describe('PJ-12 массовое назначение', () => {
  it('commonIds: отмечен у всех', () => {
    expect(commonIds([['a', 'b'], ['b', 'c'], ['b']])).toEqual(['b']);
    expect(commonIds([])).toEqual([]);
  });
  it('снятие снимает у всех, остальных не затрагивает', () => {
    expect(applyToggle(['a', 'b'], ['b'], [])).toEqual(['a']);
    expect(applyToggle(['b'], ['b'], [])).toEqual([]);
  });
  it('добавление дополняет, без дублей', () => {
    expect(applyToggle(['a'], ['b'], ['b', 'c'])).toEqual(['a', 'c']);
    expect(applyToggle(['c'], [], ['c'])).toEqual(['c']);
  });
});
