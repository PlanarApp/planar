import { ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { type SyncPushRequest, type SyncPushResponse } from '@planar/shared';
import type { Db } from '../db/index.js';
import { clientMutations } from '../db/schema.js';
import { PushQueue } from '../push/push.js';
import { DB } from '../tokens.js';
import { Reject, runMutation } from './mutate.js';

type Result = SyncPushResponse['results'][number];

@Injectable()
export class PushService {
  constructor(
    @Inject(DB) private db: Db,
    @Optional() @Inject(PushQueue) private queue?: PushQueue,
  ) {}

  async push(userId: string, req: SyncPushRequest, tokenId?: string): Promise<SyncPushResponse> {
    // владелец clientId проверяется и при пустой пачке (в one() — под блокировкой строки)
    const [owner] = await this.db
      .select({ userId: clientMutations.userId })
      .from(clientMutations)
      .where(eq(clientMutations.clientId, req.clientId));
    if (owner && owner.userId !== userId)
      throw new ForbiddenException('clientId принадлежит другому пользователю');
    const results: Result[] = [];
    for (const m of req.mutations) results.push(await this.one(userId, req.clientId, m, tokenId));
    return { results };
  }

  private async one(
    userId: string,
    clientId: string,
    m: SyncPushRequest['mutations'][number],
    tokenId?: string,
  ): Promise<Result> {
    const notified: string[] = [];
    try {
      const res = await this.db.transaction(async (tx) => {
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
        if (m.id <= cm.lastMutationId) return { id: m.id, ok: true as const };

        await runMutation(tx, userId, m, notified, tokenId);
        await tx
          .update(clientMutations)
          .set({ lastMutationId: m.id, updatedAt: sql`now()` })
          .where(eq(clientMutations.clientId, clientId));
        return { id: m.id, ok: true as const };
      });
      // после COMMIT; повтор уже учтённой мутации ничего не создаёт
      await this.queue?.enqueue(notified);
      return res;
    } catch (err) {
      if (!(err instanceof Reject)) throw err;
      await this.db
        .insert(clientMutations)
        .values({ clientId, userId, lastMutationId: m.id })
        .onConflictDoUpdate({
          target: clientMutations.clientId,
          set: { lastMutationId: m.id, updatedAt: sql`now()` },
        });
      return { id: m.id, ok: false, code: err.code, message: err.message };
    }
  }
}
