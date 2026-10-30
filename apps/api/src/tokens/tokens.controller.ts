import { randomBytes } from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { apiTokenCreatedSchema, apiTokenSchema } from '@planar/shared';
import { getAuth } from '../auth/auth.js';
import { HttpError } from '../auth/errors.js';
import { hashToken } from '../auth/sessions.js';
import { parseBody } from '../auth/validate.js';
import type { Db } from '../db/index.js';
import { apiTokens } from '../db/schema.js';
import { DB } from '../tokens.js';

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** plnr_ + 32 random bytes in base62, exactly 43 characters (left-padded with '0'). */
export function newSecret(): string {
  let n = BigInt('0x' + randomBytes(32).toString('hex'));
  let s = '';
  for (; n > 0n; n /= 62n) s = B62[Number(n % 62n)]! + s;
  return 'plnr_' + s.padStart(43, '0');
}

const createBody = z.object({
  name: z.string().min(1).max(100),
  scope: z.enum(['read', 'write']),
  expiresAt: z.iso.datetime({ offset: true }).nullish(),
});

const wire = (t: typeof apiTokens.$inferSelect) =>
  apiTokenSchema.parse({
    id: t.id,
    name: t.name,
    prefix: t.prefix,
    scope: t.scope,
    expiresAt: t.expiresAt && new Date(t.expiresAt).toISOString(),
    lastUsedAt: t.lastUsedAt && new Date(t.lastUsedAt).toISOString(),
    revokedAt: t.revokedAt && new Date(t.revokedAt).toISOString(),
    createdAt: new Date(t.createdAt).toISOString(),
  });

@Controller('api/tokens')
export class TokensController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get()
  async list(@Req() req: object) {
    const rows = await this.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.userId, getAuth(req).userId))
      .orderBy(desc(apiTokens.createdAt));
    return { tokens: rows.map(wire) };
  }

  @Post()
  async create(@Req() req: object, @Body() body: unknown) {
    const b = parseBody(createBody, body);
    if (b.expiresAt && Date.parse(b.expiresAt) <= Date.now())
      throw new HttpError(400, 'invalid_request', 'expiresAt должен быть в будущем');
    const secret = newSecret();
    const [row] = await this.db
      .insert(apiTokens)
      .values({
        userId: getAuth(req).userId,
        name: b.name,
        scope: b.scope,
        expiresAt: b.expiresAt ? new Date(b.expiresAt).toISOString() : null,
        tokenSha256: hashToken(secret),
        prefix: secret.slice(5, 13),
      })
      .returning();
    return apiTokenCreatedSchema.parse({ token: wire(row!), secret });
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@Req() req: object, @Param('id') id: string) {
    const ok = z.uuid().safeParse(id).success;
    const done = ok
      ? await this.db
          .update(apiTokens)
          .set({ revokedAt: new Date().toISOString() })
          .where(
            and(
              eq(apiTokens.id, id),
              eq(apiTokens.userId, getAuth(req).userId),
              isNull(apiTokens.revokedAt),
            ),
          )
          .returning({ id: apiTokens.id })
      : [];
    if (!done.length) throw new HttpError(404, 'not_found', 'Токен не найден');
  }
}
