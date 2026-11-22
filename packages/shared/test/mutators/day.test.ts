// PLNRAPP-709: «My day» works on tasks.dueDate — day.* mutators and dayPlans are gone (C-schema v31, C-mutators v23)
import { describe, expect, it } from 'vitest';
import { ENTITIES, createRegistry, domainMutators } from '../../src/index';
import { mem, run, seedSpace, seedTask } from './helpers';

describe('PLNRAPP-709: мой день по dueDate', () => {
  it('нет мутаторов day.* и сущности dayPlans', () => {
    const reg = createRegistry(domainMutators);
    for (const n of ['day.plan', 'day.move', 'day.remove']) expect(reg.get(n)).toBeUndefined();
    expect(Object.keys(ENTITIES)).not.toContain('dayPlans');
  });

  it('«на сегодня», «на завтра», «перенести» ставят dueDate, «убрать из дня» очищает', async () => {
    const tx = mem();
    const s = await seedSpace(tx);
    const t = await seedTask(tx, s, { dueDate: '2026-11-20' });
    // carry over: an overdue task → today
    await run(tx, 'task.update', { id: t, dueDate: '2026-11-22' });
    expect(await tx.get('tasks', t)).toMatchObject({ dueDate: '2026-11-22' });
    // to tomorrow
    await run(tx, 'task.update', { id: t, dueDate: '2026-11-23' });
    expect(await tx.get('tasks', t)).toMatchObject({ dueDate: '2026-11-23' });
    // remove from the day
    await run(tx, 'task.update', { id: t, dueDate: null });
    expect(await tx.get('tasks', t)).toMatchObject({ dueDate: null });
  });
});
