import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { descendantsOfSelected } from '../merge';

describe('PLNRAPP-117 массовое слияние: кто не может быть целевой', () => {
  // a ← b ← c (c — внук a), d отдельно; x ← y — y под невыбранной x
  const parents: Record<string, string | null> = {
    a: null,
    b: 'a',
    c: 'b',
    d: null,
    x: null,
    y: 'x',
  };
  const parentOf = async (id: string) => parents[id];

  it('потомок выбранной на любой глубине — не целевая', async () => {
    expect([...(await descendantsOfSelected(['a', 'c', 'd'], parentOf))]).toEqual(['c']);
    expect([...(await descendantsOfSelected(['a', 'b', 'c'], parentOf))].sort()).toEqual([
      'b',
      'c',
    ]);
  });

  it('родитель не в выборке — ограничений нет; цикл в данных не зацикливает', async () => {
    expect([...(await descendantsOfSelected(['y', 'd'], parentOf))]).toEqual([]);
    const loop = async (id: string) => (({ p: 'q', q: 'p' }) as Record<string, string>)[id];
    expect([...(await descendantsOfSelected(['p', 'd'], loop))]).toEqual([]);
  });
});
