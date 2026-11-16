import { describe, expect, it } from 'vitest';
import { keep, same } from '../query';

describe('keep', () => {
  it('равный результат — прежний объект', () => {
    const prev = [{ id: 'a', n: 1, tags: ['x'] }, { id: 'b' }];
    expect(keep(prev, structuredClone(prev))).toBe(prev);
    const m = new Map([['k', { v: 1 }]]);
    expect(keep(m, new Map([['k', { v: 1 }]]))).toBe(m);
    const s = new Set(['a', 'b']);
    expect(keep(s, new Set(['b', 'a']))).toBe(s);
    const o = { a: [1], b: { c: 'x' } };
    expect(keep(o, { b: { c: 'x' }, a: [1] })).toBe(o);
  });

  it('неизменённые строки берутся из прошлого результата по id', () => {
    const a = { id: 'a', n: 1 };
    const b = { id: 'b', n: 1 };
    const next = keep([a, b], [{ id: 'b', n: 2 }, { id: 'a', n: 1 }, { id: 'c' }]);
    expect(next[1]).toBe(a);
    expect(next[0]).toEqual({ id: 'b', n: 2 });
    expect(next).toHaveLength(3);
    // the same elements in another order — a new array
    const prev = [a, b];
    const swapped = keep(prev, [{ ...b }, { ...a }]);
    expect(swapped).not.toBe(prev);
    expect(swapped[0]).toBe(b);
  });

  it('same: порядок ключей не важен, отличия видны', () => {
    expect(same({ a: 1, b: null }, { b: null, a: 1 })).toBe(true);
    expect(same({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(same({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(same(null, { a: 1 })).toBe(false);
    expect(same([1, 2], [2, 1])).toBe(false);
    expect(same(undefined, undefined)).toBe(true);
  });
});
