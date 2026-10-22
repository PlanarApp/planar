import { z } from 'zod';
import { MutatorError, defineMutator, type Tx } from '../contract/index.js';
import { need, uuid } from './util.js';

const role = z.enum(['admin', 'member', 'guest']);

async function assertNotLastAdmin(tx: Tx, spaceId: string, memberId: string) {
  const admins = (await tx.scan('spaceMembers', { index: 'spaceId', eq: spaceId })).filter(
    (m) => m.role === 'admin',
  );
  if (admins.length === 1 && admins[0].id === memberId)
    throw new MutatorError('conflict', 'последний admin');
}

export const memberMutators = [
  defineMutator({
    name: 'member.add',
    args: z.object({ id: uuid, spaceId: uuid, userId: uuid, role }),
    async run(tx, a, ctx) {
      await need(tx, 'spaces', a.spaceId);
      const dup = (await tx.scan('spaceMembers', { index: 'spaceId', eq: a.spaceId })).some(
        (m) => m.userId === a.userId,
      );
      if (dup) throw new MutatorError('conflict', 'уже участник');
      await tx.put('spaceMembers', { ...a, createdAt: ctx.now, updatedAt: ctx.now });
    },
  }),
  defineMutator({
    name: 'member.update',
    args: z.object({ id: uuid, role }),
    async run(tx, a, ctx) {
      const m = await need(tx, 'spaceMembers', a.id);
      if (a.role !== 'admin') await assertNotLastAdmin(tx, m.spaceId, m.id);
      await tx.patch('spaceMembers', a.id, { role: a.role, updatedAt: ctx.now });
    },
  }),
  defineMutator({
    name: 'member.remove',
    args: z.object({ id: uuid }),
    async run(tx, a) {
      const m = await need(tx, 'spaceMembers', a.id);
      await assertNotLastAdmin(tx, m.spaceId, m.id);
      await tx.del('spaceMembers', a.id);
    },
  }),
];
