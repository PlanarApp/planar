import { describe, expect, it } from 'vitest';
import { reorder } from '../sidebarActions';

const items = (...ranks: string[]) => ranks.map((rank, i) => ({ id: String(i), rank }));
const order = (list: { id: string; rank: string }[], ch: [{ id: string }, string][]) => {
  const m = new Map(ch.map(([x, r]) => [x.id, r]));
  return list
    .map((x) => ({ ...x, rank: m.get(x.id) ?? x.rank }))
    .sort((a, b) => (a.rank < b.rank ? -1 : 1))
    .map((x) => x.id);
};

describe('reorder: ранги после перетаскивания в сайдбаре', () => {
  it('меняется только перенесённый: вверх, вниз, в начало, в конец', () => {
    const l = items('a0', 'a1', 'a2', 'a3');
    for (const [from, to, want] of [
      [3, 1, ['0', '3', '1', '2']],
      [0, 2, ['1', '2', '0', '3']],
      [2, 0, ['2', '0', '1', '3']],
      [1, 3, ['0', '2', '3', '1']],
    ] as const) {
      const ch = reorder(l, from, to);
      expect(ch).toHaveLength(1);
      expect(order(l, ch)).toEqual(want);
    }
  });

  it('одинаковые ранги соседей (старые данные) — список ранжируется заново', () => {
    const l = items('a0', 'a0', 'a0');
    const ch = reorder(l, 2, 1);
    expect(ch.length).toBeGreaterThan(1);
    expect(order(l, ch)).toEqual(['0', '2', '1']);
  });
});
