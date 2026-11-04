// PLANARAPP-10: «My day» — day.plan / day.move / day.remove (C-schema v19, C-mutators v16)
import { describe, expect, it } from 'vitest';
import { U1, U2, code, ctx, id, mem, run, seedSpace, seedTask } from './helpers';

describe('PLANARAPP-10: мой день', () => {
  it('day.plan: строка владельца; повтор той же задачи на ту же дату — ничего', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const t = await seedTask(tx, s);
    const a = id();
    await run(tx, 'day.plan', { id: a, taskId: t, date: '2026-11-04', rank: 'a0' });
    await run(tx, 'day.plan', { id: id(), taskId: t, date: '2026-11-04', rank: 'a1' });
    const rows = await tx.scan('dayPlans', { index: 'taskId', eq: t });
    expect(rows).toMatchObject([{ id: a, userId: U1, taskId: t, date: '2026-11-04', rank: 'a0' }]);
    // another day is another plan
    await run(tx, 'day.plan', { id: id(), taskId: t, date: '2026-11-05', rank: 'a0' });
    expect(await tx.scan('dayPlans', { index: 'taskId', eq: t })).toHaveLength(2);
  });

  it('day.plan несуществующей задачи → not_found', async () => {
    const tx = mem();
    await seedSpace(tx);
    expect(
      await code(run(tx, 'day.plan', { id: id(), taskId: id(), date: '2026-11-04', rank: 'a0' })),
    ).toBe('not_found');
  });

  it('day.move переносит на другой день и меняет порядок; day.remove удаляет', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const t = await seedTask(tx, s);
    const a = id();
    await run(tx, 'day.plan', { id: a, taskId: t, date: '2026-11-03', rank: 'a0' });
    await run(tx, 'day.move', { id: a, date: '2026-11-04' });
    expect(await tx.get('dayPlans', a)).toMatchObject({ date: '2026-11-04', rank: 'a0' });
    await run(tx, 'day.move', { id: a, rank: 'b0' });
    expect(await tx.get('dayPlans', a)).toMatchObject({ date: '2026-11-04', rank: 'b0' });
    await run(tx, 'day.remove', { id: a });
    expect(await tx.get('dayPlans', a)).toBeUndefined();
  });

  it('чужой план нельзя двигать и удалять', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const t = await seedTask(tx, s);
    const a = id();
    await run(tx, 'day.plan', { id: a, taskId: t, date: '2026-11-04', rank: 'a0' });
    expect(await code(run(tx, 'day.move', { id: a, rank: 'b0' }, ctx(U2)))).toBe('forbidden');
    expect(await code(run(tx, 'day.remove', { id: a }, ctx(U2)))).toBe('forbidden');
  });
});
