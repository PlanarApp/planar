import { timingSafeEqual } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { uuidv7 } from '@planar/shared';
import { AUTH_OPTS, type AuthOpts } from '../auth/auth.js';
import { HttpError } from '../auth/errors.js';
import { createHandoffSession } from '../auth/sessions.js';
import type { Db } from '../db/index.js';
import { settings, users } from '../db/schema.js';
import { ServerTx } from '../sync/server-tx.js';
import { DB } from '../tokens.js';
import { ensureSystemUser } from '../users/system.js';
import {
  CLOUD_SETTING,
  cloudStateSchema,
  setCloudPublic,
  trialDaysLeft,
  type CloudPublic,
  type CloudState,
} from './cloud.js';

const HOUR = 3600_000;
/** the badge and the admins' notification — from this many days before the end of the trial */
export const WARN_DAYS = 30;

/** cloud-link: the instance pulls its trial/payment state from the cloud (CLOUD_URL + CLOUD_TOKEN). */
@Injectable()
export class CloudService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly log = new Logger('cloud');

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AUTH_OPTS) private readonly opts: AuthOpts,
  ) {}

  get enabled() {
    return !!this.opts.cloud;
  }

  async onModuleInit() {
    setCloudPublic(null);
    if (!this.opts.cloud) return;
    // the last saved state: the gate works even if the cloud is unavailable at start
    const [row] = await this.db.select().from(settings).where(eq(settings.id, CLOUD_SETTING));
    setCloudPublic((row?.value as CloudPublic | undefined) ?? null);
    void this.state().catch((e) => this.log.warn(`cloud: ${(e as Error).message}`));
    this.timer = setInterval(
      () => void this.state().catch((e) => this.log.warn(`cloud: ${(e as Error).message}`)),
      HOUR,
    );
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Fresh state from the cloud; saved (public part) and applied to the gate. */
  async state(): Promise<CloudState> {
    const s = cloudStateSchema.parse(await this.call('GET', '/api/link/state'));
    await this.save(s);
    return s;
  }

  async setDomain(host: string | null): Promise<CloudState> {
    const s = cloudStateSchema.parse(await this.call('POST', '/api/link/domain', { host }));
    await this.save(s);
    return s;
  }

  /** Data export: the cloud's CLI builds the archive, the browser downloads it from the cloud (link valid 10 minutes). */
  async exportData(): Promise<{ url: string }> {
    const { path } = z
      .object({ path: z.string().regex(/^\/api\/export\/[\w.-]+$/) })
      .parse(await this.call('POST', '/api/link/export', undefined, 10 * 60_000)); // = CLI timeout
    return { url: `${this.opts.cloud!.url}${path}` };
  }

  /** Import replaces all data and restarts this instance, so the browser uploads the archive straight to the cloud (link valid 10 minutes). */
  async importData(confirm: string): Promise<{ url: string }> {
    const { path } = z
      .object({ path: z.string().regex(/^\/api\/import\/[\w.-]+$/) })
      .parse(await this.call('POST', '/api/link/import', { confirm }));
    return { url: `${this.opts.cloud!.url}${path}` };
  }

  async deleteInstance(confirm: string): Promise<void> {
    await this.call('POST', '/api/link/delete', { confirm });
  }

  /** The wipe restarts this very instance, so the cloud runs it in the background and shows its own waiting page. */
  async resetInstance(b: { confirm: string; password: string }): Promise<{ url: string }> {
    const { ticket } = z
      .object({ ticket: z.string().regex(/^[\w-]+$/) })
      .parse(await this.call('POST', '/api/link/reset', b));
    return { url: `${this.opts.cloud!.url}/reset/${ticket}` };
  }

  /** One-time sign-in of the owner for the cloud admin; the caller proves itself with CLOUD_TOKEN. */
  async handoff(authorization: string | undefined): Promise<string> {
    const want = this.opts.cloud?.token;
    const got = Buffer.from(/^Bearer (\S+)$/.exec(authorization ?? '')?.[1] ?? '');
    if (!want || got.length !== Buffer.byteLength(want) || !timingSafeEqual(got, Buffer.from(want)))
      throw new HttpError(401, 'unauthenticated', 'Неверный токен облака');
    const [owner] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'owner'), isNull(users.deactivatedAt)))
      .orderBy(users.createdAt)
      .limit(1);
    if (!owner) throw new HttpError(404, 'not_found', 'Нет владельца');
    return createHandoffSession(this.db, owner.id);
  }

  private async call(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    timeoutMs = 60_000, // domain binding waits for the CLI
  ): Promise<unknown> {
    const c = this.opts.cloud;
    if (!c) throw new HttpError(404, 'not_found', 'Инстанс не в облаке');
    let r: Response;
    try {
      r = await fetch(`${c.url}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${c.token}`,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new HttpError(503, 'unavailable', `Облако недоступно: ${(e as Error).message}`);
    }
    if (r.ok) return r.json();
    // h3 error: the code is in statusMessage, details (e.g. IP for dns_missing) — in data
    const err = (await r.json().catch(() => ({}))) as { statusMessage?: string; data?: unknown };
    const code = err.statusMessage || r.statusText || String(r.status);
    throw new HttpError(
      r.status >= 500 ? 503 : 400,
      r.status >= 500 ? 'unavailable' : 'invalid_request',
      code,
      { cloud: code, data: err.data },
    );
  }

  private async save(s: CloudState) {
    const [row] = await this.db.select().from(settings).where(eq(settings.id, CLOUD_SETTING));
    const prev = row?.value as CloudPublic | undefined;
    const next: CloudPublic = { status: s.status, trialEndsAt: s.trialEndsAt };
    const left = trialDaysLeft(next);
    // one notification per trial end date (extended trial — notify again)
    const notify = left !== null && left <= WARN_DAYS && prev?.notified !== s.trialEndsAt;
    if (notify || prev?.notified) next.notified = notify ? s.trialEndsAt : prev!.notified;
    setCloudPublic(next);
    if (JSON.stringify(prev) === JSON.stringify(next)) return;
    const sys = await ensureSystemUser(this.db);
    await this.db.transaction(async (q) => {
      const tx = ServerTx.asSystem(q, { userId: sys });
      const createdAt = new Date().toISOString();
      await tx.put('settings', { id: CLOUD_SETTING, value: next, updatedAt: createdAt });
      if (notify) {
        const admins = await q
          .select({ id: users.id })
          .from(users)
          .where(and(inArray(users.role, ['owner', 'admin']), isNull(users.deactivatedAt)));
        for (const a of admins)
          await tx.put('notifications', {
            id: uuidv7(),
            userId: a.id,
            spaceId: null,
            kind: 'trial_ending',
            taskId: null,
            url: '/settings/cloud',
            body: null,
            commentId: null,
            changes: null,
            actorId: sys,
            readAt: null,
            createdAt,
          });
      }
      await tx.finish();
    });
  }
}
