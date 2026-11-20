import { ServerTx, type Q, type ServerTxCtx } from './server-tx.js';

/**
 * PLNRAPP-700: favourites of deleted tasks are removed for all users. favorites.refId has no FK and
 * task.delete may not delete other users' rows (write: self), so the system tx does it in the same
 * transaction — with sync changes, the sidebar updates for every user without F5.
 * Returns the hook's ServerTx (its finish() — notification about what was written).
 */
export async function favoritesHook(q: Q, source: ServerTx, ctx: ServerTxCtx): Promise<ServerTx> {
  const sys = ServerTx.asSystem(q, ctx, { locked: source.isLocked });
  for (const w of source.writes) {
    if (w.op !== 'del' || w.entity !== 'tasks' || !w.before) continue;
    for (const f of await sys.scan('favorites', { index: 'refId', eq: w.before.id }))
      if (f.kind === 'task') await sys.del('favorites', f.id);
  }
  return sys;
}
