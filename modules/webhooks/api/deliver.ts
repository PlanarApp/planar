import { and, eq, lte, sql } from 'drizzle-orm';
import type { Db, JobApi, JobDef, ModuleHookApi, Q } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import { webhooksDeliveries as D, webhooksSubscriptions as S } from './schema.js';
import { post, sign } from './send.js';
import { BlockedAddress } from './ssrf.js';

export const QUEUE = 'webhooks.deliver';
const MAX_ATTEMPTS = 11;
/** pause after a failed attempt n (1–10): 60·2^(n−1) s */
export const retryDelaySec = (n: number): number => 60 * 2 ** (n - 1);
/** a lease for the duration of the attempt: a crashed worker does not block delivery forever (sweep will pick it up) */
const LEASE_SEC = 300;

type Delivery = typeof D.$inferSelect;

/** A new delivery (pending, due — now). The caller enqueues the job; without it sweep will pick it up. */
export async function createDelivery(
  q: Q | Db,
  subscriptionId: string,
  event: string,
  data: object,
): Promise<Delivery> {
  const [row] = await (q as Q)
    .insert(D)
    .values({
      id: uuidv7(),
      subscriptionId,
      event,
      payload: data as Record<string, unknown>,
      status: 'pending',
      nextAttemptAt: new Date().toISOString(),
    })
    .returning();
  return row!;
}

/** For automations: send_webhook to the given (active) subscription. */
export async function enqueueWebhookEvent(
  api: ModuleHookApi | JobApi,
  subscriptionId: string,
  event: string,
  data: object,
): Promise<void> {
  const q = 'q' in api ? api.q : api.db;
  const [sub] = await (q as Q).select({ active: S.active }).from(S).where(eq(S.id, subscriptionId));
  if (!sub?.active) return;
  const d = await createDelivery(q, subscriptionId, event, data);
  await api.enqueue(QUEUE, { deliveryId: d.id });
}

const bodyOf = (d: Delivery) =>
  JSON.stringify({
    id: d.id,
    event: d.event,
    createdAt: new Date(d.createdAt).toISOString(),
    data: d.payload,
  });

/** One delivery attempt; a retry is a new job with startAfter. */
export async function attempt(deliveryId: string, api: Pick<JobApi, 'db' | 'enqueue'>) {
  const now = new Date();
  // capture: only a timely pending delivery; a parallel job gets 0 rows
  const [d] = await api.db
    .update(D)
    .set({
      attempts: sql`${D.attempts} + 1`,
      nextAttemptAt: new Date(now.getTime() + LEASE_SEC * 1000).toISOString(),
    })
    .where(
      and(eq(D.id, deliveryId), eq(D.status, 'pending'), lte(D.nextAttemptAt, now.toISOString())),
    )
    .returning();
  if (!d) return;
  const [sub] = await api.db.select().from(S).where(eq(S.id, d.subscriptionId));
  let patch: Partial<Delivery>;
  if (!sub || (!sub.active && d.event !== 'ping')) {
    patch = { status: 'failed', nextAttemptAt: null, lastError: 'subscription_inactive' };
  } else {
    const body = bodyOf(d);
    try {
      const status = await post(sub.url, body, {
        'Content-Type': 'application/json',
        'User-Agent': 'Planar-Webhooks/1',
        'X-Planar-Event': d.event,
        'X-Planar-Delivery': d.id,
        'X-Planar-Signature': sign(sub.secret, body),
      });
      if (status >= 200 && status < 300)
        patch = { status: 'ok', nextAttemptAt: null, lastStatus: status, lastError: null };
      else
        patch = {
          lastStatus: status,
          lastError: status >= 300 && status < 400 ? 'redirect' : `http_${status}`,
        };
    } catch (e) {
      patch =
        e instanceof BlockedAddress
          ? { status: 'failed', nextAttemptAt: null, lastError: 'blocked_address' }
          : { lastError: e instanceof Error ? e.message.slice(0, 500) : 'error' };
    }
    if (!patch.status) {
      if (d.attempts >= MAX_ATTEMPTS)
        Object.assign(patch, { status: 'failed', nextAttemptAt: null });
      else {
        const delay = retryDelaySec(d.attempts);
        patch.nextAttemptAt = new Date(Date.now() + delay * 1000).toISOString();
        await api.db
          .update(D)
          .set({ ...patch, updatedAt: new Date().toISOString() })
          .where(eq(D.id, d.id));
        await api.enqueue(QUEUE, { deliveryId: d.id }, { startAfter: delay });
        return;
      }
    }
  }
  await api.db
    .update(D)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(D.id, d.id));
}

export const jobs: JobDef<Record<string, unknown>>[] = [
  {
    queue: QUEUE,
    retryLimit: 0,
    localConcurrency: 4,
    handler: (data, api) => attempt(String(data.deliveryId), api),
  },
  {
    // deliveries without a job (ping, manual retry) and lost jobs
    queue: 'webhooks.sweep',
    cron: '* * * * *',
    async handler(_, api) {
      const due = await api.db
        .select({ id: D.id })
        .from(D)
        .where(and(eq(D.status, 'pending'), lte(D.nextAttemptAt, new Date().toISOString())))
        .limit(200);
      for (const r of due) await api.enqueue(QUEUE, { deliveryId: r.id });
    },
  },
];
