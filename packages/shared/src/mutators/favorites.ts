import { z } from 'zod';
import {
  MutatorError,
  defineMutator,
  entitySchemas,
  type MutatorCtx,
  type Tx,
} from '../contract/index.js';
import { need, rank, uuid } from './util.js';

const fav = entitySchemas.favorites.shape;

/** The user's own favorites row; someone else's → forbidden. */
async function own(tx: Tx, id: string, ctx: MutatorCtx) {
  const f = await need(tx, 'favorites', id);
  if (f.userId !== ctx.userId) throw new MutatorError('forbidden', 'чужое избранное');
  return f;
}

// Favourites (PLNRAPP-124): personal list, synced between devices
export const favoriteMutators = [
  defineMutator({
    name: 'favorite.add',
    args: z.object({
      id: uuid,
      kind: fav.kind,
      refId: fav.refId,
      name: fav.name,
      url: fav.url,
      rank,
    }),
    async run(tx, a, ctx) {
      // already in the user's favourites — nothing
      const same = await tx.scan('favorites', { index: 'refId', eq: a.refId });
      if (same.some((f) => f.userId === ctx.userId && f.kind === a.kind)) return;
      await tx.put('favorites', {
        ...a,
        userId: ctx.userId,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
    },
  }),
  defineMutator({
    name: 'favorite.move',
    args: z.object({ id: uuid, rank }),
    async run(tx, a, ctx) {
      await own(tx, a.id, ctx);
      await tx.patch('favorites', a.id, { rank: a.rank, updatedAt: ctx.now });
    },
  }),
  defineMutator({
    name: 'favorite.remove',
    args: z.object({ id: uuid }),
    async run(tx, a, ctx) {
      await own(tx, a.id, ctx);
      await tx.del('favorites', a.id);
    },
  }),
];
