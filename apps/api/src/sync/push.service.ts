import { ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { type SyncPushRequest, type SyncPushResponse } from '@planar/shared';
import type { Db } from '../db/index.js';
import { clientMutations } from '../db/schema.js';
import { PushQueue } from '../push/push.js';
import { DB } from '../tokens.js';
import { Reject, runMutation } from './mutate.js';
import type { Q, TxCache } from './server-tx.js';

type Result = SyncPushResponse['results'][number];
type Mutation = SyncPushRequest['mutations'][number];

/** Mutations per transaction: the global lock 7311 is held until its commit. */
export const PUSH_BATCH = 10;
/** shortcut: only the last 100 rejections per client are replayed to a retry; enough while a retry resends one push */
const KEEP_REJECTED = 100;
type Rejected = (typeof clientMutations.$inferSelect)['rejected'][number];
const keep = (old: Rejected[], add: Rejected[]) => [...old, ...add].slice(-KEEP_REJECTED);

const failed = (m: Mutation, err: Reject): Result => ({
  id: m.id,
  ok: false,
  code: err.code,
  message: err.message,
});

@Injectable()
export class PushService {
  constructor(
    @Inject(DB) private db: Db,
    @Optional() @Inject(PushQueue) private queue?: PushQueue,
  ) {}

  async push(userId: string, req: SyncPushRequest, tokenId?: string): Promise<SyncPushResponse> {
    // the clientId owner is checked even for an empty batch (in batch() — under the row lock)
    const [owner] = await this.db
      .select({ userId: clientMutations.userId })
      .from(clientMutations)
      .where(eq(clientMutations.clientId, req.clientId));
    if (owner && owner.userId !== userId)
      throw new ForbiddenException('clientId принадлежит другому пользователю');
    const results: Result[] = [];
    let rest = req.mutations;
    while (rest.length) rest = await this.batch(userId, req.clientId, rest, results, tokenId);
    return { results };
  }

  /**
   * Up to PUSH_BATCH mutations in one transaction; returns the ones left. The first executed one runs without
   * a savepoint (a push of one mutation costs nothing extra), the next ones each in its own: a Reject rolls back
   * only that one. A Reject of the first one rolls back the transaction, the rest go to the next one.
   */
  private async batch(
    userId: string,
    clientId: string,
    muts: Mutation[],
    results: Result[],
    tokenId?: string,
  ): Promise<Mutation[]> {
    const notified: string[] = [];
    const done: Result[] = [];
    const rejected: Rejected[] = [];
    const cache: TxCache = {};
    let n = 0;
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .insert(clientMutations)
          .values({ clientId, userId, lastMutationId: 0 })
          .onConflictDoNothing();
        const [cm] = await tx
          .select()
          .from(clientMutations)
          .where(eq(clientMutations.clientId, clientId))
          .for('update');
        if (cm.userId !== userId)
          throw new ForbiddenException('clientId принадлежит другому пользователю');
        let last = cm.lastMutationId;
        let ran = false;
        for (; n < muts.length && n < PUSH_BATCH; n++) {
          const m = muts[n];
          if (m.id <= last) {
            // a repeat: the answer it got the first time (the client may have lost it)
            const r = cm.rejected.find((x) => x.id === m.id);
            done.push(r ? ({ ...r, ok: false } as Result) : { id: m.id, ok: true });
            continue;
          }
          const mine: string[] = [];
          const run = (q: Q) =>
            runMutation(q, userId, m, mine, tokenId, { jobs: this.queue?.jobs, cache });
          if (!ran) await run(tx);
          else
            try {
              await tx.transaction(run);
            } catch (err) {
              if (!(err instanceof Reject)) throw err;
              // the cache may hold what the rolled back mutation saw
              delete cache.hidden;
              delete cache.modules;
              done.push(failed(m, err));
              rejected.push({ id: m.id, code: err.code, message: err.message });
              last = m.id;
              continue;
            }
          ran = true;
          notified.push(...mine);
          done.push({ id: m.id, ok: true });
          last = m.id;
        }
        if (last !== cm.lastMutationId)
          await tx
            .update(clientMutations)
            .set({
              lastMutationId: last,
              ...(rejected.length && { rejected: keep(cm.rejected, rejected) }),
              updatedAt: sql`now()`,
            })
            .where(eq(clientMutations.clientId, clientId));
      });
    } catch (err) {
      if (!(err instanceof Reject)) throw err;
      // muts[n] is the first executed one: before it there were only repeats
      const m = muts[n];
      const r = { id: m.id, code: err.code, message: err.message };
      await this.db.transaction(async (tx) => {
        await tx
          .insert(clientMutations)
          .values({ clientId, userId, lastMutationId: 0 })
          .onConflictDoNothing();
        const [cm] = await tx
          .select()
          .from(clientMutations)
          .where(eq(clientMutations.clientId, clientId))
          .for('update');
        await tx
          .update(clientMutations)
          .set({ lastMutationId: m.id, rejected: keep(cm.rejected, [r]), updatedAt: sql`now()` })
          .where(eq(clientMutations.clientId, clientId));
      });
      results.push(...done, failed(m, err));
      return muts.slice(n + 1);
    }
    // after COMMIT; a repeat of an already counted mutation creates nothing
    await this.queue?.enqueue(notified);
    results.push(...done);
    return muts.slice(n);
  }
}
