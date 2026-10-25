import { describe, expect, it } from 'vitest';
import { treeOrder } from '../tree';

const t = (id: string, parentId: string | null = null) => ({ id, parentId });
const flat = (xs: ReturnType<typeof treeOrder>) => xs.map((x) => `${x.task.id}:${x.depth}`);

describe('treeOrder', () => {
  it('подзадачи сразу под родителем, вложенность любой глубины', () => {
    expect(flat(treeOrder([t('a'), t('b'), t('a1', 'a'), t('a1x', 'a1'), t('b1', 'b')]))).toEqual([
      'a:0',
      'a1:1',
      'a1x:2',
      'b:0',
      'b1:1',
    ]);
  });
  it('порядок внутри уровня — как во входе', () => {
    expect(flat(treeOrder([t('a2', 'a'), t('a'), t('a1', 'a')]))).toEqual(['a:0', 'a2:1', 'a1:1']);
  });
  it('родителя нет в наборе — подзадача на верхнем уровне', () => {
    expect(flat(treeOrder([t('x', 'missing'), t('a')]))).toEqual(['x:0', 'a:0']);
  });
  it('цикл в данных не зацикливает и не теряет задачи', () => {
    const ids = treeOrder([t('a', 'b'), t('b', 'a')]).map((x) => x.task.id);
    expect(ids.sort()).toEqual(['a', 'b']);
  });
});
