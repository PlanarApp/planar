import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/index.js';
import { DB } from '../tokens.js';
import { AUTH_OPTS, authenticateRaw, type AuthCtx, type AuthOpts } from './auth.js';
import { HttpError } from './errors.js';
import { IS_PUBLIC } from './public.js';
import { sessionCookie } from './sessions.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AUTH_OPTS) private readonly opts: AuthOpts,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }
    const req = context.switchToHttp().getRequest<FastifyRequest & { auth?: AuthCtx }>();
    const ctx = await authenticateRaw(this.db, req.headers, req.method, this.opts);
    if (!ctx) throw new HttpError(401, 'unauthenticated', 'Требуется вход');
    req.auth = ctx;
    if (ctx.renewedToken) {
      void context
        .switchToHttp()
        .getResponse<FastifyReply>()
        .header('set-cookie', sessionCookie(ctx.renewedToken, { secure: this.opts.cookieSecure }));
    }
    return true;
  }
}
