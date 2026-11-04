import { z } from 'zod';
import { MutatorError, defineMutator, type MutatorCtx, type Tx } from '../contract/index.js';
import { date, need, rank, uuid } from './util.js';

/** The user's own dayPlans row; someone else's → forbidden. */
async function own(tx: Tx, id: string, ctx: MutatorCtx) {
  const p = await need(tx, 'dayPlans', id);
  if (p.userId !== ctx.userId) throw new MutatorError('forbidden', 'чужой план дня');
  return p;
}

// «My day» (PLANARAPP-10): personal plan of tasks for a date
export const dayMutators = [
  defineMutator({
    name: 'day.plan',
    args: z.object({ id: uuid, taskId: uuid, date, rank }),
    async run(tx, a, ctx) {
      await need(tx, 'tasks', a.taskId);
      // the task is already planned for this date — nothing
      const same = await tx.scan('dayPlans', { index: 'taskId', eq: a.taskId });
      if (same.some((p) => p.userId === ctx.userId && p.date === a.date)) return;
      await tx.put('dayPlans', {
        id: a.id,
        userId: ctx.userId,
        taskId: a.taskId,
        date: a.date,
        rank: a.rank,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    // another date (carry over) and/or another place in the day
    name: 'day.move',
    args: z.object({ id: uuid, date: date.optional(), rank: rank.optional() }),
    async run(tx, a, ctx) {
      await own(tx, a.id, ctx);
      await tx.patch('dayPlans', a.id, {
        ...(a.date && { date: a.date }),
        ...(a.rank && { rank: a.rank }),
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'day.remove',
    args: z.object({ id: uuid }),
    async run(tx, a, ctx) {
      await own(tx, a.id, ctx);
      await tx.del('dayPlans', a.id);
    },
  }),
];
