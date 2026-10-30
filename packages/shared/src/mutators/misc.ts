import { z } from 'zod';
import { MutatorError, defineMutator, type Tx, type MutatorCtx } from '../contract/index.js';
import { changes, need, rank, record, uuid } from './util.js';

/** All notifications rows with these ids; someone else's → forbidden; missing ones are skipped. */
async function own(tx: Tx, ids: string[], ctx: MutatorCtx) {
  const rows = [];
  for (const id of ids) {
    const n = await tx.get('notifications', id);
    if (!n) continue;
    if (n.userId !== ctx.userId) throw new MutatorError('forbidden', 'чужое уведомление');
    rows.push(n);
  }
  return rows;
}

const viewName = z.string().min(1).max(100);
const viewIcon = z.string().max(32).nullable().optional(); // lucide icon name from the web set

export const miscMutators = [
  defineMutator({
    name: 'notification.read',
    args: z.object({ ids: z.array(uuid) }),
    async run(tx, a, ctx) {
      for (const n of await own(tx, a.ids, ctx))
        await tx.patch('notifications', n.id, { readAt: ctx.now });
    },
  }),
  defineMutator({
    name: 'notification.delete',
    args: z.object({ ids: z.array(uuid) }),
    async run(tx, a, ctx) {
      for (const n of await own(tx, a.ids, ctx)) await tx.del('notifications', n.id);
    },
  }),
  defineMutator({
    name: 'view.create',
    args: z.object({
      id: uuid,
      spaceId: uuid,
      personal: z.boolean(),
      name: viewName,
      icon: viewIcon,
      layout: z.string().min(1),
      filter: record,
      config: record,
      rank,
    }),
    async run(tx, a, ctx) {
      await need(tx, 'spaces', a.spaceId);
      const { personal, ...rest } = a;
      await tx.put('savedViews', {
        ...rest,
        icon: a.icon ?? null,
        userId: personal ? ctx.userId : null,
        createdBy: ctx.userId,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'view.update',
    args: z.object({
      id: uuid,
      name: viewName.optional(),
      icon: viewIcon,
      layout: z.string().min(1).optional(),
      filter: record.optional(),
      config: record.optional(),
      rank: rank.optional(),
    }),
    async run(tx, a, ctx) {
      await need(tx, 'savedViews', a.id);
      await tx.patch('savedViews', a.id, changes('savedViews', a, ctx));
    },
  }),
  defineMutator({
    name: 'view.delete',
    args: z.object({ id: uuid }),
    async run(tx, a) {
      await tx.del('savedViews', a.id);
    },
  }),
  defineMutator({
    name: 'settings.set',
    args: z.object({ id: z.string().min(1), value: z.json() }),
    async run(tx, a, ctx) {
      await tx.put('settings', { id: a.id, value: a.value, updatedAt: ctx.now });
    },
  }),
];
