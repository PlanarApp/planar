// PLNRAPP-709: «My day» works on tasks.dueDate (task.update)
import { describe, expect, it } from 'vitest';
import { mem, run, seedSpace, seedTask } from './helpers';

describe('PLNRAPP-709: мой день по dueDate', () => {
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
