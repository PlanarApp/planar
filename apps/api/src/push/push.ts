import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  Post,
  Req,
  Res,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import type { PgBoss } from 'pg-boss';
import webpush from 'web-push';
import { z } from 'zod';
import { pushPayloadSchema, type PushPayload } from '@planar/shared';
import { isDemo } from '@planar/server-kit';
import { BadRequestException } from '@nestjs/common';
import { getAuth } from '../auth/auth.js';
import type { Db } from '../db/index.js';
import { notifications, projects, pushSubscriptions, tasks } from '../db/schema.js';
import { JobsService, PUSH_OPTS } from '../jobs/jobs.js';
import { DB } from '../tokens.js';

export const QUEUE = 'push.notification';
export { PUSH_OPTS };

export interface PushSub {
  endpoint: string;
  p256dh: string;
  auth: string;
}
/** Sends Web Push; on a push-service response throws an error with statusCode. */
export interface PushSender {
  send(sub: PushSub, payload: PushPayload): Promise<void>;
}
export interface PushOpts {
  /** pg-boss: false — queue does not start (enqueue — no-op) */
  boss: boolean;
  /** queue worker; false — enqueue only (tests) */
  worker?: boolean;
  /** VAPID: no keys — push is disabled */
  vapid?: { publicKey?: string; privateKey?: string; subject?: string };
  /** sender substitution (tests) */
  sender?: PushSender;
  databaseUrl: string;
}

export class WebPushSender implements PushSender {
  constructor(private v: { publicKey: string; privateKey: string; subject: string }) {}
  async send(s: PushSub, p: PushPayload) {
    if (isDemo()) return; // demo: no outgoing requests
    await webpush.sendNotification(
      { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      JSON.stringify(p),
      { vapidDetails: this.v as never },
    );
  }
}

const TITLES: Record<string, string> = {
  assigned: 'Вам назначена задача',
  mentioned: 'Вас упомянули',
  commented: 'Новый комментарий',
  status_changed: 'Статус задачи изменён',
  chat_mention: 'Упоминание в чате',
  chat_dm: 'Личное сообщение',
  chat_reply: 'Ответ в треде',
};

/** pg-boss queue + delivery. Provider PUSH_QUEUE for PushService. */
@Injectable()
export class PushQueue implements OnApplicationShutdown {
  private log = new Logger('push-queue');
  private boss?: PgBoss;
  private sender?: PushSender;
  private ready?: Promise<void>;

  constructor(
    @Inject(DB) private db: Db,
    @Inject(PUSH_OPTS) private opts: PushOpts,
    @Optional() @Inject(JobsService) readonly jobs: JobsService = new JobsService(db, opts),
  ) {
    jobs.push = this;
    const v = opts.vapid;
    this.sender =
      opts.sender ??
      (v?.publicKey && v.privateKey
        ? new WebPushSender({
            publicKey: v.publicKey,
            privateKey: v.privateKey,
            subject: v.subject || 'mailto:admin@localhost',
          })
        : undefined);
    if (!this.sender) this.log.warn('VAPID-ключей нет: push выключен, уведомления создаются');
  }

  get vapidPublicKey() {
    return this.opts.vapid?.publicKey || undefined;
  }

  /** Start pg-boss (lazy, once). */
  private start(): Promise<void> {
    return (this.ready ??= (async () => {
      const boss = await this.jobs.start();
      if (!boss) return;
      await boss.createQueue(QUEUE);
      if (this.opts.worker !== false)
        await boss.work<{ notificationId: string }>(
          QUEUE,
          { pollingIntervalSeconds: 0.5 },
          async (jobs) => {
            for (const j of jobs) await this.deliver(j.data.notificationId);
          },
        );
      this.boss = boss;
    })().catch((e) => {
      this.ready = undefined; // the next enqueue will retry
      throw e;
    }));
  }

  async onModuleInit() {
    if (this.opts.boss) await this.start();
  }

  /** After COMMIT: one job per notification. A queue failure does not roll back the mutation. */
  async enqueue(ids: string[]): Promise<void> {
    if (!ids.length || !this.opts.boss) return;
    try {
      await this.start();
      for (const notificationId of ids) await this.boss!.send(QUEUE, { notificationId });
    } catch (e) {
      this.log.error(e);
    }
  }

  /** Delivers one notification to all of the recipient's subscriptions; 404/410 — the subscription is deleted. */
  async deliver(notificationId: string): Promise<void> {
    if (!this.sender) return;
    const [n] = await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, notificationId));
    if (!n) return;
    let body: string;
    let url: string;
    if (n.taskId) {
      const [t] = await this.db
        .select({ title: tasks.title, number: tasks.number, key: projects.key })
        .from(tasks)
        .innerJoin(projects, eq(projects.id, tasks.projectId))
        .where(eq(tasks.id, n.taskId));
      if (!t) return; // job deleted: nothing to open
      body = t.title;
      url = `/t/${t.key}-${t.number}`;
    } else {
      body = n.body ?? '';
      url = n.url ?? '';
    }
    const payload: PushPayload = {
      title: TITLES[n.kind] ?? 'Уведомление',
      body,
      url,
      tag: n.id,
      kind: n.kind as PushPayload['kind'],
    };
    // invalid url (foreign site in SW) is not sent
    if (!pushPayloadSchema.safeParse(payload).success) return;
    const subs = await this.db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, n.userId));
    for (const s of subs) {
      try {
        await this.sender.send(s, payload);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410)
          await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, s.id));
        else this.log.warn(`push ${s.id}: ${(e as Error).message}`);
      }
    }
  }

  async onApplicationShutdown() {
    await this.ready?.catch(() => {});
    await this.jobs.onApplicationShutdown(); // without Nest (tests) nobody stops it; a repeat is safe
  }
}

const sub = z.object({
  endpoint: z.url(),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
});
const unsub = z.object({ endpoint: z.string().min(1) });

function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.message).join('; '));
  return r.data;
}

@Controller('api/push')
export class PushController {
  constructor(
    @Inject(DB) private db: Db,
    @Inject(PushQueue) private queue: PushQueue,
  ) {}

  @Get('vapid')
  vapid() {
    const publicKey = this.queue.vapidPublicKey;
    if (!publicKey) throw new NotFoundException('VAPID не настроен');
    return { publicKey };
  }

  @Post('subscribe')
  async subscribe(
    @Req() req: object,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const { userId } = getAuth(req);
    const b = parse(sub, body);
    const ua = (req as { headers?: Record<string, string> }).headers?.['user-agent'] ?? null;
    const [prev] = await this.db
      .select({ userId: pushSubscriptions.userId })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, b.endpoint));
    // endpoint is unique: a repeat (including from another account of the same browser) takes over the current one
    await this.db
      .insert(pushSubscriptions)
      .values({
        userId,
        endpoint: b.endpoint,
        p256dh: b.keys.p256dh,
        auth: b.keys.auth,
        userAgent: ua,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId, p256dh: b.keys.p256dh, auth: b.keys.auth, userAgent: ua },
      });
    res.status(prev ? 200 : 201);
    return {};
  }

  @Delete('subscribe')
  @HttpCode(204)
  async unsubscribe(@Req() req: object, @Body() body: unknown) {
    const { userId } = getAuth(req);
    const b = parse(unsub, body);
    await this.db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.endpoint, b.endpoint), eq(pushSubscriptions.userId, userId)));
  }
}
