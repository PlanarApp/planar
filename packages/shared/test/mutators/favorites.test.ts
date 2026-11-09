// PLNRAPP-124: favourites on the server — favorite.add / move / remove (C-schema v21, C-mutators v17)
import { describe, expect, it } from 'vitest';
import { U1, U2, code, ctx, id, mem, run } from './helpers';

const fav = (refId: string, rank = 'a0', kind = 'project') => ({
  id: id(),
  kind,
  refId,
  name: 'Platform',
  url: `/p/${refId}`,
  rank,
});

describe('PLNRAPP-124: избранное', () => {
  it('favorite.add: строка владельца; повтор того же объекта — ничего; другой пользователь — своя строка', async () => {
    const tx = mem();
    const p = id();
    const a = fav(p);
    await run(tx, 'favorite.add', a);
    await run(tx, 'favorite.add', fav(p, 'a1'));
    await run(tx, 'favorite.add', fav(p), ctx(U2));
    const rows = await tx.scan('favorites', { index: 'refId', eq: p });
    expect(rows.filter((r) => r.userId === U1)).toMatchObject([{ id: a.id, rank: 'a0' }]);
    expect(rows).toHaveLength(2);
    // the same id of another kind is another favourite
    await run(tx, 'favorite.add', fav(p, 'a2', 'space'));
    expect(await tx.scan('favorites', { index: 'refId', eq: p })).toHaveLength(3);
  });

  it('favorite.move меняет порядок, favorite.remove удаляет; чужое — forbidden', async () => {
    const tx = mem();
    const a = fav('w', 'a0', 'workspace');
    await run(tx, 'favorite.add', a);
    expect(await code(run(tx, 'favorite.move', { id: a.id, rank: 'b0' }, ctx(U2)))).toBe(
      'forbidden',
    );
    expect(await code(run(tx, 'favorite.remove', { id: a.id }, ctx(U2)))).toBe('forbidden');
    await run(tx, 'favorite.move', { id: a.id, rank: 'b0' });
    expect(await tx.get('favorites', a.id)).toMatchObject({ rank: 'b0' });
    await run(tx, 'favorite.remove', { id: a.id });
    expect(await tx.get('favorites', a.id)).toBeUndefined();
  });

  it('неизвестный вид — ошибка аргументов', async () => {
    const tx = mem();
    await expect(run(tx, 'favorite.add', fav(id(), 'a0', 'board'))).rejects.toThrow();
  });
});
