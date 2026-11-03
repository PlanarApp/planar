import { beforeEach, describe, expect, it } from 'vitest';
import { useSelection } from '../selection';

describe('PJ-22 выбрать все', () => {
  const sel = useSelection();
  beforeEach(() => sel.clear());
  it('state: none / some / all', () => {
    expect(sel.state(['a', 'b'])).toBe('none');
    sel.toggle('a');
    expect(sel.state(['a', 'b'])).toBe('some');
    sel.toggle('b');
    expect(sel.state(['a', 'b'])).toBe('all');
  });
  it('toggleAll: из частичного — выбрать все, из полного — снять только свои', () => {
    sel.toggle('a');
    sel.toggle('x');
    sel.toggleAll(['a', 'b']);
    expect([...sel.selected.value].sort()).toEqual(['a', 'b', 'x']);
    sel.toggleAll(['a', 'b']);
    expect([...sel.selected.value]).toEqual(['x']);
  });
  it('пустой список ничего не выбирает', () => {
    sel.toggleAll([]);
    expect(sel.selected.value.size).toBe(0);
  });
});
