import { describe, expect, it } from 'vitest';
import type { Row } from '@planar/shared';
import { actKey, groupRuns, mergeChanges } from '../activityGroups';

const act = (actorId: string, kind: string, changes: Record<string, unknown> = {}) =>
  ({
    id: crypto.randomUUID(),
    actorId,
    kind,
    changes,
    createdAt: '',
  }) as unknown as Row<'activity'>;

describe('PLNRAPP-825 группировка истории', () => {
  it('ключ: автор, вид и набор полей правки', () => {
    expect(actKey(act('a', 'updated', { description: [1, 2] }))).toBe(
      actKey(act('a', 'updated', { description: [3, 4] })),
    );
    expect(actKey(act('a', 'updated', { description: 1, title: 2 }))).toBe(
      actKey(act('a', 'updated', { title: 3, description: 4 })),
    );
    expect(actKey(act('a', 'updated', { description: 1 }))).not.toBe(
      actKey(act('b', 'updated', { description: 1 })),
    );
    expect(actKey(act('a', 'updated', { description: 1 }))).not.toBe(
      actKey(act('a', 'updated', { title: 1 })),
    );
    expect(actKey(act('a', 'label_added'))).not.toBe(actKey(act('a', 'label_removed')));
  });
  it('объединяются только соседние; null (комментарий) разрывает цепочку', () => {
    const k = (x: string) => (x === 'c' ? null : x);
    expect(groupRuns(['a', 'a', 'b', 'a', 'c', 'c', 'a', 'a'], k)).toEqual([
      ['a', 'a'],
      ['b'],
      ['a'],
      ['c'],
      ['c'],
      ['a', 'a'],
    ]);
    expect(groupRuns([], k)).toEqual([]);
  });
  it('значения: от первого старого к последнему новому', () => {
    expect(
      mergeChanges([
        act('a', 'updated', { statusId: ['s1', 's2'], description: [{}, {}] }),
        act('a', 'updated', { statusId: ['s2', 's3'], description: [{}, {}] }),
      ]),
    ).toEqual({ statusId: ['s1', 's3'], description: [{}, {}] });
  });
});
