import { describe, expect, it } from 'vitest';
import { applyAssignees, applyToggle, commonIds } from '../selection';

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

describe('PLNRAPP-498 режимы массового назначения', () => {
  it('добавить: дополняет текущих, без дублей', () => {
    expect(applyAssignees('add', ['a'], ['a', 'b'])).toEqual(['a', 'b']);
    expect(applyAssignees('add', [], ['c'])).toEqual(['c']);
  });
  it('убрать: снимает выбранных, остальных не трогает', () => {
    expect(applyAssignees('remove', ['a', 'b', 'c'], ['b', 'd'])).toEqual(['a', 'c']);
    expect(applyAssignees('remove', ['a'], [])).toEqual(['a']);
  });
  it('заменить: ровно выбранный набор, пустой снимает всех', () => {
    expect(applyAssignees('set', ['a', 'b'], ['c'])).toEqual(['c']);
    expect(applyAssignees('set', ['a', 'b'], [])).toEqual([]);
  });
});
