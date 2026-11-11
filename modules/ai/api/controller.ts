import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  CORE,
  encrypt,
  HttpError,
  parseBody,
  secretKey,
  type CoreServices,
} from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import {
  AI_PROVIDERS,
  AI_SCOPES,
  INSTANCE_SCOPE_ID,
  type AiConnectionView,
  type AiScope,
} from '../shared/index.js';
import { resolveConnection, secretOf, viewOf } from './connections.js';
import { checkConnection, ConnectionCheckFailed, type LlmConnection } from './llm.js';
import { aiConnections as C } from './schema.js';

const baseUrl = z
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
const price = z.number().min(0).max(1_000_000);
const putBody = z
  .object({
    scope: z.enum(AI_SCOPES),
    scopeId: z.uuid().optional(),
    provider: z.enum(AI_PROVIDERS),
    baseUrl: baseUrl.nullish(),
    /** omitted on an update: the saved key stays */
    apiKey: z.string().min(1).max(500).optional(),
    model: z.string().min(1).max(200),
    priceIn: price.nullish(),
    priceOut: price.nullish(),
  })
  .refine((b) => b.provider !== 'openai-compatible' || !!b.baseUrl, {
    message: 'для openai-compatible нужен baseUrl',
    path: ['baseUrl'],
  })
  .refine((b) => (b.scope === 'instance') === (b.scopeId === undefined), {
    message: 'scopeId нужен у space и project и не нужен у instance',
    path: ['scopeId'],
  });
const listQuery = z.object({ scope: z.enum(AI_SCOPES), scopeId: z.uuid().optional() });

const nf = () => new HttpError(404, 'not_found', 'Не найдено');

@Controller('api/ai')
export class AiController {
  constructor(@Inject(CORE) private core: CoreServices) {}

  /** Admin of the level: instance — owner/admin; space — admin of the space; project — admin of the project. Session only. */
  private async admin(req: object, scope: AiScope, scopeId: string) {
    const a = this.core.auth(req);
    if (a.tokenId) throw new HttpError(403, 'forbidden', 'Только из сессии');
    if (scope === 'instance') {
      this.core.requireInstanceAdmin(req, { sessionOnly: true });
      return;
    }
    const q =
      scope === 'space'
        ? sql`select (u.role in ('owner', 'admin') or sm.role = 'admin') as ok
            from spaces s left join users u on u.id = ${a.userId}::uuid
            left join space_members sm on sm.space_id = s.id and sm.user_id = ${a.userId}::uuid
            where s.id = ${scopeId}::uuid`
        : sql`select (project_role(${a.userId}::uuid, p.id) = 'admin'
              and 'ai' = any(p.modules)) as ok
            from projects p where p.id = ${scopeId}::uuid`;
    const r = await this.core.db.execute(q);
    // no such space / project and no right look the same
    if (!r.rows[0]) throw nf();
    if (!r.rows[0].ok) throw new HttpError(403, 'forbidden', 'Нужна роль администратора');
  }

  /** The level's own connection and the one in force for it (project: nearest of project, space, instance). */
  @Get('connections')
  async list(@Req() req: object, @Query() query: unknown) {
    const q = parseBody(listQuery, query);
    const scopeId = q.scope === 'instance' ? INSTANCE_SCOPE_ID : q.scopeId;
    if (!scopeId) throw new HttpError(400, 'invalid_request', 'scopeId обязателен');
    await this.admin(req, q.scope, scopeId);
    const [own] = await this.core.db.select().from(C).where(eqScope(q.scope, scopeId));
    let effective: Awaited<ReturnType<typeof resolveConnection>> = null;
    if (!own && q.scope === 'project') effective = await resolveConnection(this.core.db, scopeId);
    else if (!own && q.scope === 'space')
      effective =
        (await this.core.db.select().from(C).where(eqScope('instance', INSTANCE_SCOPE_ID)))[0] ??
        null;
    return {
      connection: own ? viewOf(own) : null,
      effective: effective ? viewOf(effective) : null,
    };
  }

  /** Create or replace the level's connection; the test call goes first — a failed check saves nothing. */
  @Put('connections')
  async save(@Req() req: object, @Body() body: unknown): Promise<{ connection: AiConnectionView }> {
    const b = parseBody(putBody, body);
    const scopeId = b.scope === 'instance' ? INSTANCE_SCOPE_ID : b.scopeId!;
    await this.admin(req, b.scope, scopeId);
    const key = secretKey();
    if (!key) throw new HttpError(503, 'unavailable', 'PLANAR_SECRET_KEY не задан');
    const [had] = await this.core.db.select().from(C).where(eqScope(b.scope, scopeId));
    let apiKey = b.apiKey;
    if (!apiKey) {
      if (!had) throw new HttpError(400, 'invalid_request', 'apiKey обязателен');
      apiKey = secretOf(had).apiKey;
    }
    const conn: LlmConnection = {
      provider: b.provider,
      baseUrl: b.baseUrl ?? null,
      apiKey,
      model: b.model,
      priceIn: b.priceIn ?? null,
      priceOut: b.priceOut ?? null,
    };
    try {
      await checkConnection(conn);
    } catch (e) {
      if (e instanceof ConnectionCheckFailed && e.kind === 'rejected')
        throw new HttpError(502, 'unavailable', 'Провайдер отклонил ключ');
      throw new HttpError(502, 'unavailable', 'Провайдер недоступен');
    }
    const v = {
      provider: conn.provider,
      baseUrl: conn.baseUrl,
      model: conn.model,
      priceIn: conn.priceIn,
      priceOut: conn.priceOut,
      keyEnc: b.apiKey ? encrypt(b.apiKey, key) : had!.keyEnc,
    };
    const [r] = await this.core.db
      .insert(C)
      .values({ id: uuidv7(), scope: b.scope, scopeId, ...v })
      .onConflictDoUpdate({ target: [C.scope, C.scopeId], set: { ...v, updatedAt: sql`now()` } })
      .returning();
    return { connection: viewOf(r!) };
  }

  @Delete('connections/:id')
  @HttpCode(204)
  async remove(@Req() req: object, @Param('id') id: string) {
    if (!z.uuid().safeParse(id).success) throw nf();
    const [c] = await this.core.db.select().from(C).where(eq(C.id, id));
    if (!c) throw nf();
    await this.admin(req, c.scope as AiScope, c.scopeId);
    await this.core.db.delete(C).where(eq(C.id, id));
  }
}

const eqScope = (scope: AiScope, scopeId: string) =>
  sql`${C.scope} = ${scope} and ${C.scopeId} = ${scopeId}::uuid`;
