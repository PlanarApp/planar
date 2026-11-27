import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  CORE,
  decrypt,
  encrypt,
  HttpError,
  parseBody,
  secretKey,
  type CoreServices,
  type Db,
} from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import {
  GITHUB_ERRORS,
  WORKSPACE_SCOPE_ID,
  type GithubLevelView,
  type GithubScope,
} from '../shared/index.js';
import { availableConnections, choiceOf, resolveConnection, viewOf } from './connections.js';
import { githubChoices as C, githubConnections as G } from './schema.js';

export const GITHUB_API = 'https://api.github.com';
const scope = z.enum(['workspace', 'space', 'project']);
const token = z.string().trim().min(1).max(500);
const connectBody = z.object({ scope, scopeId: z.uuid(), token });
const choiceBody = z.object({ connectionId: z.uuid().nullable() });
const invalid = (m: string) => new HttpError(400, 'invalid_request', m);
const notFound = () => new HttpError(404, 'not_found', 'Не найдено');
const uuidOr404 = (id: string) => {
  if (!z.uuid().safeParse(id).success) throw notFound();
  return id;
};

const keyOrThrow = () => {
  const key = secretKey();
  if (!key) throw new HttpError(503, 'unavailable', 'PLANAR_SECRET_KEY не задан');
  return key;
};

/** The decrypted token of the connection in force for a level; null — GitHub is not connected there. */
export async function githubToken(
  db: Pick<Db, 'select' | 'execute'>,
  sc: GithubScope = 'workspace',
  scopeId: string = WORKSPACE_SCOPE_ID,
): Promise<string | null> {
  const r = await resolveConnection(db, sc, scopeId);
  if (!r) return null;
  const key = keyOrThrow();
  try {
    return decrypt(r.tokenEnc, key);
  } catch {
    throw new HttpError(503, 'unavailable', 'Токен GitHub не расшифровывается');
  }
}

/** GET /user with the token: the login; 401/403 — 400 with badToken; no answer / other errors — 502. */
async function githubLogin(t: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${GITHUB_API}/user`, {
      headers: {
        Authorization: `Bearer ${t}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Planar',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HttpError(502, 'unavailable', GITHUB_ERRORS.unavailable);
  }
  if (res.status === 401 || res.status === 403) throw invalid(GITHUB_ERRORS.badToken);
  if (!res.ok) throw new HttpError(502, 'unavailable', GITHUB_ERRORS.unavailable);
  const body = (await res.json().catch(() => null)) as { login?: unknown } | null;
  if (typeof body?.login !== 'string' || !body.login)
    throw new HttpError(502, 'unavailable', GITHUB_ERRORS.unavailable);
  return body.login;
}

// PLNRAPP-890: github.com connections of the levels workspace / space / project, managed by the instance admin —
// the same levels, choice and rights as the GitLab connections (modules/gitlab)
@Controller('api/github')
export class GithubController {
  constructor(@Inject(CORE) private core: CoreServices) {}

  private admin(req: object) {
    return this.core.requireInstanceAdmin(req, { sessionOnly: true });
  }

  /** The level exists: the workspace (nil uuid), a space or a project. */
  private async level(sc: GithubScope, id: string) {
    if (sc === 'workspace') {
      if (id !== WORKSPACE_SCOPE_ID) throw notFound();
      return;
    }
    const r = await this.core.db.execute(
      sql`select 1 from ${sql.raw(sc === 'space' ? 'spaces' : 'projects')} where id = ${uuidOr404(id)}::uuid`,
    );
    if (!r.rows.length) throw notFound();
  }

  /** Connections available to a level, its own choice and the effective connection. */
  @Get('levels/:scope/:scopeId')
  async levelView(
    @Req() req: object,
    @Param('scope') sc: string,
    @Param('scopeId') id: string,
  ): Promise<GithubLevelView> {
    this.admin(req);
    const s = parseBody(scope, sc) as GithubScope;
    await this.level(s, id);
    const db = this.core.db;
    return {
      connections: (await availableConnections(db, s, id)).map(viewOf),
      choice: await choiceOf(db, s, id),
      effective: (await resolveConnection(db, s, id))?.id ?? null,
    };
  }

  /** null — inherit; otherwise a connection of the level itself or of a level above. */
  @Put('levels/:scope/:scopeId/choice')
  async setChoice(
    @Req() req: object,
    @Param('scope') sc: string,
    @Param('scopeId') id: string,
    @Body() body: unknown,
  ) {
    this.admin(req);
    const s = parseBody(scope, sc) as GithubScope;
    const b = parseBody(choiceBody, body);
    await this.level(s, id);
    if (b.connectionId === null)
      await this.core.db.delete(C).where(and(eq(C.scope, s), eq(C.scopeId, id)));
    else {
      if (!(await availableConnections(this.core.db, s, id)).some((x) => x.id === b.connectionId))
        throw invalid('Подключение недоступно этому уровню');
      await this.core.db
        .insert(C)
        .values({ scope: s, scopeId: id, connectionId: b.connectionId })
        .onConflictDoUpdate({
          target: [C.scope, C.scopeId],
          set: { connectionId: b.connectionId },
        });
    }
    return { choice: b.connectionId };
  }

  /** Checks the token at GitHub, then saves the connection of the level (encrypted token). */
  @Post('connections')
  async connect(@Req() req: object, @Body() body: unknown) {
    const a = this.admin(req);
    const b = parseBody(connectBody, body);
    await this.level(b.scope, b.scopeId);
    const key = keyOrThrow();
    const login = await githubLogin(b.token);
    const r = await this.core.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(G)
        .values({
          id: uuidv7(),
          scope: b.scope,
          scopeId: b.scopeId,
          login,
          tokenEnc: encrypt(b.token, key),
          connectedBy: a.userId,
        })
        .returning();
      // the own connection of a space / project is what that level uses from now on
      if (b.scope !== 'workspace')
        await tx
          .insert(C)
          .values({ scope: b.scope, scopeId: b.scopeId, connectionId: row!.id })
          .onConflictDoUpdate({ target: [C.scope, C.scopeId], set: { connectionId: row!.id } });
      return row!;
    });
    return { connection: viewOf(r) };
  }

  /** Disconnect: the connection is deleted; levels that chose it fall back to inheriting. */
  @Delete('connections/:id')
  @HttpCode(204)
  async disconnect(@Req() req: object, @Param('id') id: string) {
    this.admin(req);
    const [r] = await this.core.db
      .select({ id: G.id })
      .from(G)
      .where(eq(G.id, uuidOr404(id)));
    if (!r) throw notFound();
    await this.core.db.transaction(async (tx) => {
      await tx.delete(C).where(eq(C.connectionId, r.id));
      await tx.delete(G).where(eq(G.id, r.id));
    });
  }
}
