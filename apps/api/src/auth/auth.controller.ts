import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { users } from '../db/schema.js';
import { DB } from '../tokens.js';
import { findUserByLogin } from '../users/users.repo.js';
import { AUTH_OPTS, getAuth, readCookie, type AuthOpts } from './auth.js';
import { HttpError } from './errors.js';
import { assertNotLimited, recordFailure, resetAttempts } from './login-limit.js';
import { verifyDummy, verifyPassword } from './password.js';
import { Public } from './public.js';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  deleteSession,
  sessionCookie,
} from './sessions.js';
import { parseBody } from './validate.js';

const loginBody = z.object({ login: z.string().max(200), password: z.string().max(256) });

const iso = (s: string | null) => (s ? new Date(s).toISOString() : null);

/** Строка users для ответов: без password_hash, даты ISO. */
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
    const token = await createSession(this.db, user.id, req.headers['user-agent']);
    void res.header('set-cookie', sessionCookie(token, { secure: this.opts.cookieSecure }));
    return { user: publicUser(user) };
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
