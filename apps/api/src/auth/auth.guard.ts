import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db/index.js';
import { DB } from '../tokens.js';
import { AUTH_OPTS, authenticateRaw, lockedError, type AuthCtx, type AuthOpts } from './auth.js';
import { cloudExpired } from '../cloud/cloud.js';
import { HttpError } from './errors.js';
import { IS_PUBLIC } from './public.js';
import { sessionCookie } from './sessions.js';

/** Routes of incomplete and locked sessions (the rest: 401 / 403 mfa_setup_required / 423). */
const STATE_ROUTES: Record<NonNullable<AuthCtx['state']>, RegExp> = {
  mfa: /^\/api\/auth\/(mfa\/verify|logout)$/,
  locked: /^\/api\/auth\/(unlock|logout|security|me)$/,
  setup: /^\/api\/auth\/(?!impersonate)/, // no impersonation before own 2FA
};

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
    const req = context
      .switchToHttp()
      .getRequest<FastifyRequest & { auth?: AuthCtx; planarRenewedToken?: string }>();
    const ctx = await authenticateRaw(
      this.db,
      req.headers,
      req.method,
      { ...this.opts, expiredAdmins: true, states: true },
      (t) => {
        req.planarRenewedToken = t;
      },
    );
    if (!ctx) throw new HttpError(401, 'unauthenticated', 'Требуется вход');
    if (ctx.state && !STATE_ROUTES[ctx.state].test(req.routeOptions.url ?? '')) {
      if (ctx.state === 'locked') throw lockedError();
      if (ctx.state === 'setup')
        throw new HttpError(403, 'mfa_setup_required', 'Включите двухфакторную аутентификацию');
      throw new HttpError(401, 'unauthenticated', 'Требуется вход');
    }
    // cloud trial is over: admins get only the payment screen (cloud-link)
    if (cloudExpired() && !/^\/api\/(auth|cloud)(\/|$)/.test(req.routeOptions.url ?? ''))
      throw new HttpError(403, 'forbidden', 'Пробный период закончился', {
        cloud: 'trial_expired',
      });
    if (ctx.via === 'token') {
      const route = req.routeOptions.url ?? '';
      if (route === '/api/tokens' || route.startsWith('/api/tokens/'))
        throw new HttpError(403, 'forbidden', 'Токенами управляют только из сессии');
      if (ctx.tokenScope === 'read' && req.method !== 'GET' && req.method !== 'HEAD')
        throw new HttpError(403, 'forbidden', 'Токен только для чтения');
    }
    req.auth = ctx;
    if (req.planarRenewedToken) {
      void context
        .switchToHttp()
        .getResponse<FastifyReply>()
        .header(
          'set-cookie',
          sessionCookie(req.planarRenewedToken, { secure: this.opts.cookieSecure }),
        );
    }
    return true;
  }
}
