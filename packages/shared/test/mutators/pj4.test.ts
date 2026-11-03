// PJ-4: view.setNodeDefault (C-mutators v12)
import { describe, expect, it } from 'vitest';
import { code, ctx, id, mem, run, seedSpace, U2 } from './helpers';

describe('PJ-4: view.setNodeDefault', () => {
  it('PJ-4 заменяет общий вид node+layout и удаляет личную строку вызывающего; прочие не трогает', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    await run(tx, 'member.add', { id: id(), spaceId: s.spaceId, userId: U2, role: 'member' });
    const node = `p:${s.projectId}`;
    const base = { spaceId: s.spaceId, node, layout: 'board', filter: {}, config: {} };
    const mine = id();
    const theirs = id();
    const other = id();
    const mk = { personal: true, name: 'board', rank: 'a0' };
    await run(tx, 'view.create', { ...base, ...mk, id: mine });
    await run(tx, 'view.create', { ...base, ...mk, id: theirs }, ctx(U2));
    await run(tx, 'view.create', { ...base, ...mk, id: other, layout: 'list' });
    const d1 = id();
    await run(tx, 'view.setNodeDefault', { ...base, id: d1, config: { a: 1 } });
    expect(await tx.get('savedViews', mine)).toBeUndefined();
    expect(await tx.get('savedViews', theirs)).toBeDefined(); // someone else's personal row stays
    const d2 = id();
    await run(tx, 'view.setNodeDefault', { ...base, id: d2, config: { a: 2 } }, ctx(U2));
    expect(await tx.get('savedViews', d1)).toBeUndefined();
    expect(await tx.get('savedViews', theirs)).toBeUndefined();
    expect(await tx.get('savedViews', other)).toBeDefined();
    expect(await tx.get('savedViews', d2)).toMatchObject({ userId: null, node, config: { a: 2 } });
  });

  it('PJ-4 guest и не участник → forbidden; неверный node → invalid_args', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    await run(tx, 'member.add', { id: id(), spaceId: s.spaceId, userId: U2, role: 'guest' });
    const a = { id: id(), spaceId: s.spaceId, node: 'w', layout: 'list', filter: {}, config: {} };
    expect(await code(run(tx, 'view.setNodeDefault', a, ctx(U2)))).toBe('forbidden');
    expect(await code(run(tx, 'view.setNodeDefault', a, ctx(id())))).toBe('forbidden');
    await expect(run(tx, 'view.setNodeDefault', { ...a, node: 'x' })).rejects.toThrow(/node/);
    expect(await code(run(tx, 'view.setNodeDefault', a))).toBe('ok');
  });
});
