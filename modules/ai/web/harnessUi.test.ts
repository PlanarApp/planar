import { describe, expect, it } from 'vitest';
import type { HarnessOp } from '../shared/index.js';
import { buildReplaceWith, groupOps, isPackPage, needReplace, replaceTargets } from './harnessUi';

const op = (kind: HarnessOp['kind'], o: HarnessOp['op'], key: string): HarnessOp => ({
  kind,
  op: o,
  key,
});

describe('harnessUi', () => {
  it('groupOps: порядок видов как при применении, пустые группы пропущены', () => {
    const g = groupOps([
      op('rule', 'create', 'r'),
      op('status', 'delete', 'a'),
      op('status', 'create', 'b'),
    ]);
    expect(g.map((x) => [x.kind, x.ops.length])).toEqual([
      ['status', 2],
      ['rule', 1],
    ]);
  });

  it('needReplace и replaceTargets', () => {
    expect(
      needReplace([
        'статус old: в нём 3 задач, нужен replaceWith',
        'replaceWith x: такого статуса нет в проекте',
      ]),
    ).toEqual(['old']);
    expect(
      replaceTargets([
        op('status', 'create', 'n'),
        op('status', 'delete', 'o'),
        op('label', 'create', 'l'),
      ]),
    ).toEqual(['n']);
  });

  it('buildReplaceWith: пустые значения отбрасываются', () => {
    expect(buildReplaceWith({ a: ' b ', c: '' })).toEqual({ a: 'b' });
  });

  it('isPackPage: только прямой потомок корня «Harness-пакеты» без родителя', () => {
    const root = { id: 'r', parentId: null, title: 'Harness-пакеты', projectId: 'p' };
    const pack = { id: 'k', parentId: 'r', title: 'Разработка', projectId: 'p' };
    const sub = { id: 's', parentId: 'k', title: 'Действие', projectId: 'p' };
    expect(isPackPage([pack, root], 'k')).toBe(true);
    expect(isPackPage([sub, pack, root], 's')).toBe(false);
    expect(isPackPage([root], 'r')).toBe(false);
    expect(isPackPage([pack, { ...root, title: 'Другое' }], 'k')).toBe(false);
  });
});
