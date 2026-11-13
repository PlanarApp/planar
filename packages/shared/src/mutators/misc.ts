import { z } from 'zod';
import {
  MutatorError,
  defineMutator,
  isDataModule,
  WORKSPACE_DATA_MODULE_IDS,
  type Tx,
  type MutatorCtx,
} from '../contract/index.js';
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
// node of a built-in tab's saved view: w | s:<id> | p:<id>, "My work" — :me-<mode>
const viewNode = z
  .string()
  .regex(/^(w|[sp]:[0-9a-f-]{36})(:me-(mine|assigned|created|watched))?$/)
  .nullable();

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
      node: viewNode.optional(),
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
        node: a.node ?? null,
        // a node's view is always the owner's own
        userId: personal || a.node ? ctx.userId : null,
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
    name: 'view.setNodeDefault',
    args: z.object({
      id: uuid,
      spaceId: uuid,
      node: viewNode.unwrap(),
      layout: z.string().min(1),
      filter: record,
      config: record,
    }),
    async run(tx, a, ctx) {
      await need(tx, 'spaces', a.spaceId);
      const members = await tx.scan('spaceMembers', { index: 'spaceId', eq: a.spaceId });
      const role = members.find((m) => m.userId === ctx.userId)?.role;
      if (!role || role === 'guest') throw new MutatorError('forbidden', 'нужна роль member');
      // the old shared default and my personal row of the same node+layout go away
      for (const v of await tx.scan('savedViews', { index: 'spaceId', eq: a.spaceId }))
        if (
          v.node === a.node &&
          v.layout === a.layout &&
          (v.userId === null || v.userId === ctx.userId)
        )
          await tx.del('savedViews', v.id);
      await tx.put('savedViews', {
        id: a.id,
        spaceId: a.spaceId,
        userId: null,
        createdBy: ctx.userId,
        name: a.layout,
        icon: null,
        layout: a.layout,
        node: a.node,
        filter: a.filter,
        config: a.config,
        rank: 'a0',
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'settings.set',
    args: z.object({ id: z.string().min(1), value: z.json() }),
    async run(tx, a, ctx) {
      // C-mutators v12: enabled_modules holds only shared modules and workspace switches of data modules (PLNRAPP-241)
      if (
        a.id === 'enabled_modules' &&
        Array.isArray(a.value) &&
        a.value.some(
          (x) => typeof x === 'string' && isDataModule(x) && !WORKSPACE_DATA_MODULE_IDS.includes(x),
        )
      )
        throw new MutatorError(
          'invalid_args',
          'enabled_modules: модули данных включаются в проекте',
        );
      await tx.put('settings', { id: a.id, value: a.value, updatedAt: ctx.now });
    },
  }),
];
