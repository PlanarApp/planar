import { randomBytes } from 'node:crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CORE, HttpError, parseBody, type CoreServices } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import { createDelivery } from './deliver.js';
import { webhooksDeliveries as D, webhooksSubscriptions as S } from './schema.js';

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** whsec_ + 32 случайных байта в base62 (43 символа, слева '0'). */
export function newSecret(): string {
  let n = BigInt('0x' + randomBytes(32).toString('hex'));
  let s = '';
  for (; n > 0n; n /= 62n) s = B62[Number(n % 62n)]! + s;
  return 'whsec_' + s.padStart(43, '0');
}

const url = z
  .string()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'нужен http(s)-адрес без логина и пароля');
const events = z.array(z.string().min(1).max(100)).min(1).max(20);
const description = z.string().max(500).nullish();
const createBody = z.object({ url, events, description });
const patchBody = z.object({
  url: url.optional(),
  events: events.optional(),
  active: z.boolean().optional(),
  description,
});

const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
const sub = (r: typeof S.$inferSelect) => ({
  id: r.id,
  url: r.url,
  events: r.events,
  active: r.active,
  description: r.description,
  createdBy: r.createdBy,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});
const delivery = (r: typeof D.$inferSelect) => ({
  id: r.id,
  subscriptionId: r.subscriptionId,
  event: r.event,
  payload: r.payload,
  status: r.status,
  attempts: r.attempts,
  nextAttemptAt: iso(r.nextAttemptAt),
  lastStatus: r.lastStatus,
  lastError: r.lastError,
  createdAt: iso(r.createdAt),
  updatedAt: iso(r.updatedAt),
});

const notFound = () => new HttpError(404, 'not_found', 'Не найдено');

@Controller('api/webhooks')
export class WebhooksController {
  constructor(@Inject(CORE) private core: CoreServices) {}

  private admin(req: object) {
    return this.core.requireInstanceAdmin(req, { sessionOnly: true });
  }

  private async one(id: string) {
    const [r] = z.uuid().safeParse(id).success
      ? await this.core.db.select().from(S).where(eq(S.id, id))
      : [];
    if (!r) throw notFound();
    return r;
  }

  @Get('subscriptions')
  async list(@Req() req: object) {
    this.admin(req);
    const rows = await this.core.db.select().from(S).orderBy(desc(S.createdAt), desc(S.id));
    return { data: rows.map(sub) };
  }

  @Post('subscriptions')
  async create(@Req() req: object, @Body() body: unknown) {
    const a = this.admin(req);
    const b = parseBody(createBody, body);
    const secret = newSecret();
    const [r] = await this.core.db
      .insert(S)
      .values({
        id: uuidv7(),
        url: b.url,
        events: b.events,
        secret,
        active: true,
        description: b.description ?? null,
        createdBy: a.userId,
      })
      .returning();
    return { data: sub(r!), secret };
  }

  @Patch('subscriptions/:id')
  async patch(@Req() req: object, @Param('id') id: string, @Body() body: unknown) {
    this.admin(req);
    const b = parseBody(patchBody, body);
    await this.one(id);
    const [r] = await this.core.db
      .update(S)
      .set({ ...b, updatedAt: new Date().toISOString() })
      .where(eq(S.id, id))
      .returning();
    return { data: sub(r!) };
  }

  @Post('subscriptions/:id/rotate-secret')
  @HttpCode(200)
  async rotate(@Req() req: object, @Param('id') id: string) {
    this.admin(req);
    await this.one(id);
    const secret = newSecret();
    await this.core.db
      .update(S)
      .set({ secret, updatedAt: new Date().toISOString() })
      .where(eq(S.id, id));
    return { secret };
  }

  @Delete('subscriptions/:id')
  @HttpCode(204)
  async remove(@Req() req: object, @Param('id') id: string) {
    this.admin(req);
    await this.one(id);
    await this.core.db.delete(S).where(eq(S.id, id));
  }

  // доставку без задачи подберёт webhooks.sweep (в kit у контроллера нет enqueue)
  @Post('subscriptions/:id/ping')
  @HttpCode(202)
  async ping(@Req() req: object, @Param('id') id: string) {
    this.admin(req);
    await this.one(id);
    return { data: delivery(await createDelivery(this.core.db, id, 'ping', {})) };
  }

  @Get('subscriptions/:id/deliveries')
  async deliveries(
    @Req() req: object,
    @Param('id') id: string,
    @Query('limit') limitQ?: string,
    @Query('cursor') cursor?: string,
  ) {
    this.admin(req);
    await this.one(id);
    const limit = Math.min(Math.max(Math.trunc(Number(limitQ)) || 50, 1), 200);
    let after;
    if (cursor) {
      try {
        const [c, i] = z
          .tuple([z.string(), z.uuid()])
          .parse(JSON.parse(Buffer.from(cursor, 'base64url').toString()));
        after = sql`(${D.createdAt}, ${D.id}) < (${c}::timestamptz, ${i}::uuid)`;
      } catch {
        throw new HttpError(400, 'invalid_request', 'Неверный cursor');
      }
    }
    const rows = await this.core.db
      .select()
      .from(D)
      .where(and(eq(D.subscriptionId, id), after))
      .orderBy(desc(D.createdAt), desc(D.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      data: page.map(delivery),
      nextCursor:
        rows.length > limit && last
          ? Buffer.from(JSON.stringify([last.createdAt, last.id])).toString('base64url')
          : null,
    };
  }

  @Post('deliveries/:id/redeliver')
  @HttpCode(202)
  async redeliver(@Req() req: object, @Param('id') id: string) {
    this.admin(req);
    const [d] = z.uuid().safeParse(id).success
      ? await this.core.db.select().from(D).where(eq(D.id, id))
      : [];
    if (!d) throw notFound();
    return {
      data: delivery(await createDelivery(this.core.db, d.subscriptionId, d.event, d.payload)),
    };
  }
}
