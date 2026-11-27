import { Body, Controller, Delete, Get, HttpCode, Inject, Put, Req } from '@nestjs/common';
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
import { GITHUB_ERRORS, type GithubConnectionView } from '../shared/index.js';
import { githubConnections as G } from './schema.js';

export const GITHUB_API = 'https://api.github.com';
const connectBody = z.object({ token: z.string().trim().min(1).max(500) });

const keyOrThrow = () => {
  const key = secretKey();
  if (!key) throw new HttpError(503, 'unavailable', 'PLANAR_SECRET_KEY не задан');
  return key;
};

const view = (r: typeof G.$inferSelect): GithubConnectionView => ({
  login: r.login,
  connectedBy: r.connectedBy,
  connectedAt: new Date(r.createdAt).toISOString(),
});

/** The decrypted token of the connection; null — GitHub is not connected. */
export async function githubToken(db: Pick<Db, 'select'>): Promise<string | null> {
  const [r] = await db.select().from(G).limit(1);
  if (!r) return null;
  try {
    return decrypt(r.tokenEnc, keyOrThrow());
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(503, 'unavailable', 'Токен GitHub не расшифровывается');
  }
}

/** GET /user with the token: the login; 401/403 — 400 with badToken; no answer / other errors — 502. */
async function githubLogin(token: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${GITHUB_API}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
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
  if (res.status === 401 || res.status === 403)
    throw new HttpError(400, 'invalid_request', GITHUB_ERRORS.badToken);
  if (!res.ok) throw new HttpError(502, 'unavailable', GITHUB_ERRORS.unavailable);
  const body = (await res.json().catch(() => null)) as { login?: unknown } | null;
  if (typeof body?.login !== 'string' || !body.login)
    throw new HttpError(502, 'unavailable', GITHUB_ERRORS.unavailable);
  return body.login;
}

// PLNRAPP-890: the workspace connection to github.com, managed by the instance admin (like the gitlab connections)
@Controller('api/github')
export class GithubController {
  constructor(@Inject(CORE) private core: CoreServices) {}

  private admin(req: object) {
    return this.core.requireInstanceAdmin(req, { sessionOnly: true });
  }

  @Get('connection')
  async get(@Req() req: object) {
    this.admin(req);
    const [r] = await this.core.db.select().from(G).limit(1);
    return { connection: r ? view(r) : null };
  }

  /** Checks the token at GitHub, then replaces the connection (one per workspace). */
  @Put('connection')
  async connect(@Req() req: object, @Body() body: unknown) {
    const a = this.admin(req);
    const { token } = parseBody(connectBody, body);
    const key = keyOrThrow();
    const login = await githubLogin(token);
    const [r] = await this.core.db.transaction(async (tx) => {
      await tx.delete(G);
      return tx
        .insert(G)
        .values({ id: uuidv7(), login, tokenEnc: encrypt(token, key), connectedBy: a.userId })
        .returning();
    });
    return { connection: view(r!) };
  }

  @Delete('connection')
  @HttpCode(204)
  async disconnect(@Req() req: object) {
    this.admin(req);
    await this.core.db.delete(G);
  }
}
