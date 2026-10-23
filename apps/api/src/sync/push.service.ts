import { ForbiddenException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { MutatorError, type SyncPushRequest, type SyncPushResponse } from '@planar/shared';
import type { Db } from '../db/index.js';
import { clientMutations } from '../db/schema.js';
import { notificationsHook } from '../notifications/hook.js';
import { PushQueue } from '../push/push.js';
import { DB } from '../tokens.js';
import { mutatorRegistry } from './registry.js';
import { ServerTx } from './server-tx.js';

type Result = SyncPushResponse['results'][number];
type FailCode = Extract<Result, { ok: false }>['code'];

/** Мутация отклонена: откат транзакции, затем учёт id отдельной транзакцией. */
class Reject extends Error {
  constructor(
    public code: FailCode,
    message: string,
  ) {
    super(message);
  }
}

// сбой соединения/сервера БД — 500 целиком, а не отказ мутации
function isInfra(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  const code = e.cause?.code ?? e.code ?? '';
  return /^(08|53|57)/.test(code) || /^E(CONN|PIPE|TIMEDOUT|HOST|NOTFOUND)/.test(code);
}

@Injectable()
export class PushService {
  private log = new Logger('push');

  constructor(
    @Inject(DB) private db: Db,
    @Optional() @Inject(PushQueue) private queue?: PushQueue,
  ) {}

  async push(userId: string, req: SyncPushRequest): Promise<SyncPushResponse> {
    const results: Result[] = [];
    for (const m of req.mutations) results.push(await this.one(userId, req.clientId, m));
    return { results };
  }

  private async one(
    userId: string,
    clientId: string,
    m: SyncPushRequest['mutations'][number],
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

        const def = mutatorRegistry().get(m.name);
        if (!def) throw new Reject('unknown_mutator', `нет мутатора ${m.name}`);
        const args = def.args.safeParse(m.args);
        if (!args.success) throw new Reject('invalid_args', args.error.message);
        const stx = new ServerTx(tx, { userId });
        const now = new Date().toISOString();
        try {
          await def.run(stx, args.data, { userId, now, server: true });
          const hook = await notificationsHook(tx, stx, { userId, now });
          notified.push(...hook.ids);
          await stx.finish();
          await hook.tx.finish();
        } catch (err) {
          if (isInfra(err)) throw err;
          if (err instanceof MutatorError) throw new Reject(err.code, err.message);
          this.log.error(err);
          throw new Reject('internal', 'Внутренняя ошибка');
        }
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
