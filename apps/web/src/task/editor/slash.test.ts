import { describe, expect, it } from 'vitest';
import { filterSlash } from './slash';

describe('slash', () => {
  it('фильтр по русскому и английскому названию', () => {
    expect(filterSlash('табл').map((i) => i.id)).toEqual(['table']);
    expect(filterSlash('todo').map((i) => i.id)).toEqual(['todo']);
    expect(filterSlash('').length).toBeGreaterThan(5);
  });
  it('без картинок — нет «Изображение»', () => {
    expect(filterSlash('изоб').map((i) => i.id)).toEqual(['image']);
    expect(filterSlash('изоб', false)).toEqual([]);
  });
});
