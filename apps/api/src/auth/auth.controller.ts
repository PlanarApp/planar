import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { cloudExpired } from '../cloud/cloud.js';
import type { Db } from '../db/index.js';
import { sessions, users } from '../db/schema.js';
import { DB } from '../tokens.js';
import { findUserByLogin } from '../users/users.repo.js';
import { AUTH_OPTS, getAuth, isAdminRole, readCookie, type AuthOpts } from './auth.js';
import { HttpError } from './errors.js';
import { assertNotLimited, recordFailure, resetAttempts } from './login-limit.js';
import { verifyDummy, verifyPassword } from './password.js';
import { Public } from './public.js';
import {
  SESSION_COOKIE,
  SETUP_HANDOFF,
  clearSessionCookie,
  createSession,
  deleteSession,
  hashToken,
  sessionCookie,
} from './sessions.js';
import { parseBody } from './validate.js';

const loginBody = z.object({ login: z.string().max(200), password: z.string().max(256) });
const impersonateBody = z.object({ userId: z.string().uuid() });
/** Instance roles by power: impersonation goes only downwards */
const RANK: Record<string, number> = { guest: 0, member: 1, admin: 2, owner: 3 };
const log = new Logger('auth');

const iso = (s: string | null) => (s ? new Date(s).toISOString() : null);

/** users row for responses: without password_hash, dates in ISO. */
export function publicUser(u: typeof users.$inferSelect) {
  const rest: Partial<typeof u> = { ...u };
  delete rest.passwordHash;
  return {
    ...rest,
    deactivatedAt: iso(u.deactivatedAt),
    createdAt: iso(u.createdAt),
    updatedAt: iso(u.updatedAt),
  };
}

@Controller('api/auth')
export class AuthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AUTH_OPTS) private readonly opts: AuthOpts,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() body: unknown,
  ) {
    const b = parseBody(loginBody, body);
    const login = b.login.toLowerCase();
    const key = `${req.ip}|${login}`;
    await assertNotLimited(this.db, key);
    const user = await findUserByLogin(this.db, login);
    const ok = user
      ? await verifyPassword(user.passwordHash, b.password)
      : (await verifyDummy(b.password), false);
    if (!user || !ok || user.deactivatedAt) {
      await recordFailure(this.db, key);
      throw new HttpError(401, 'invalid_credentials', 'Неверный логин или пароль');
    }
    await resetAttempts(this.db, key);
    if (cloudExpired() && !isAdminRole(user.role))
      throw new HttpError(403, 'forbidden', 'Пробный период закончился', {
        cloud: 'trial_expired',
      });
    return this.startSession(req, res, user);
  }

  /** cloud-link: one-time sign-in after the instance is created in the cloud — the setup loginToken session is exchanged for a normal one. */
  @Public()
  @Get('handoff')
  async handoff(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
    @Query('token') token?: string,
  ) {
    const [s] = token
      ? await this.db
          .delete(sessions)
          .where(eq(sessions.id, hashToken(token)))
          .returning()
      : [];
    let to = '/login';
    if (s && Date.parse(s.expiresAt) > Date.now()) {
      const fresh = await createSession(this.db, s.userId, req.headers['user-agent']);
      void res.header('set-cookie', sessionCookie(fresh, { secure: this.opts.cookieSecure }));
      // the first sign-in after setup: the web shows which login and password to use next time
      to = s.userAgent === SETUP_HANDOFF ? '/w?welcome=1' : '/';
    }
    return res.status(302).header('location', to).send();
  }

  private async startSession(
    req: FastifyRequest,
    res: FastifyReply,
    user: typeof users.$inferSelect,
  ) {
    // the AI bot (PLNRAPP-167) has no sign-in: login, demo and impersonation all end up here
    if (user.bot) throw new HttpError(401, 'invalid_credentials', 'Неверный логин или пароль');
    const token = await createSession(this.db, user.id, req.headers['user-agent']);
    void res.header('set-cookie', sessionCookie(token, { secure: this.opts.cookieSecure }));
    return { user: publicUser(user) };
  }

  /** DEMO_MODE only: session of the «demo» user without a password. */
  @Public()
  @Post('demo-login')
  @HttpCode(200)
  async demoLogin(@Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const user = this.opts.demo ? await findUserByLogin(this.db, 'demo') : undefined;
    if (!user || user.deactivatedAt) throw new HttpError(404, 'not_found', 'Not found');
    return this.startSession(req, res, user);
  }

  /**
   * Sign in as another user (PLNRAPP-129): only an instance admin/owner, only from a browser session (not
   * an API token), only as an active user of a strictly lower role — no escalation; the admin's own session
   * is replaced (back — sign in again).
   */
  @Post('impersonate')
  @HttpCode(200)
  async impersonate(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() body: unknown,
  ) {
    const me = getAuth(req);
    const b = parseBody(impersonateBody, body);
    if (me.via !== 'session' || !isAdminRole(me.role))
      throw new HttpError(403, 'forbidden', 'Недостаточно прав');
    const [user] = await this.db.select().from(users).where(eq(users.id, b.userId));
    if (!user || user.deactivatedAt)
      throw new HttpError(404, 'not_found', 'Пользователь не найден');
    if ((RANK[user.role] ?? RANK.owner) >= RANK[me.role])
      throw new HttpError(
        403,
        'forbidden',
        'Можно войти только под пользователем с ролью ниже вашей',
      );
    if (cloudExpired())
      throw new HttpError(403, 'forbidden', 'Пробный период закончился', {
        cloud: 'trial_expired',
      });
    const own = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (own) await deleteSession(this.db, own);
    log.warn(`impersonate: ${me.userId} → ${user.id} (${user.login})`);
    return this.startSession(req, res, user);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (token) await deleteSession(this.db, token);
    void res.header('set-cookie', clearSessionCookie({ secure: this.opts.cookieSecure }));
  }

  @Get('me')
  async me(@Req() req: object) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, getAuth(req).userId));
    return { user: publicUser(user!) };
  }
}
