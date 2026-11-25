import type { IncomingHttpHeaders } from 'node:http';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { apiTokens, sessions, users, userSecurity } from '../db/schema.js';
import { cloudExpired, cloudPublic } from '../cloud/cloud.js';
import { HttpError } from './errors.js';
import {
  SESSION_COOKIE,
  deleteSession,
  deleteUserSessions,
  hashToken,
  sessionExpiry,
} from './sessions.js';

export type AuthCtx = {
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'guest';
  via: 'session' | 'token';
  tokenScope?: 'read' | 'write';
  tokenId?: string;
  /** session only: 'mfa' — second factor pending; 'setup' — 2FA required, not set up; 'locked' — app lock */
  state?: 'mfa' | 'setup' | 'locked';
};

export const AUTH_OPTS = Symbol('AUTH_OPTS');
export type AuthOpts = {
  publicUrl: string;
  cookieSecure: boolean;
  setupToken?: string;
  demo?: boolean;
  demoResetHours?: number;
  /** CLOUD_URL + CLOUD_TOKEN: the instance is hosted in the cloud (docs/contracts/cloud-link.md) */
  cloud?: { url: string; token: string };
};

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'UPGRADE']);

/**
 * Allowed Origins: PUBLIC_URL, EXTRA_ORIGINS (comma-separated; e.g. 127.0.0.1 next to localhost in dev)
 * and the cloud domain + custom domain (PLNRAPP-416: the instance answers on both, a PWA may be on either).
 */
export function allowedOrigins(
  publicUrl: string,
  extra = process.env.EXTRA_ORIGINS ?? '',
): string[] {
  const cloud = (cloudPublic()?.hosts ?? []).map((h) => `https://${h}`);
  const list = [publicUrl, ...extra.split(','), ...cloud].map((u) => u.trim()).filter(Boolean);
  return list.flatMap((u) => {
    try {
      return [new URL(u).origin];
    } catch {
      return []; // a typo in EXTRA_ORIGINS neither opens access nor crashes the server
    }
  });
}
const DAY = 86400_000;

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

/** Authorization: Bearer plnr_… → token context; null — missing/revoked/expired/owner deactivated. */
async function authenticateBearer(db: Db, secret: string): Promise<AuthCtx | null> {
  const [row] = await db
    .select({ t: apiTokens, role: users.role })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(
      and(
        eq(apiTokens.tokenSha256, hashToken(secret)),
        isNull(apiTokens.revokedAt),
        isNull(users.deactivatedAt),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, sql`now()`)),
      ),
    );
  if (!row) return null;
  // no more than once a minute
  await db
    .update(apiTokens)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(apiTokens.id, row.t.id),
        or(
          isNull(apiTokens.lastUsedAt),
          lt(apiTokens.lastUsedAt, sql`now() - interval '1 minute'`),
        ),
      ),
    );
  return {
    userId: row.t.userId,
    role: row.role as AuthCtx['role'],
    via: 'token',
    tokenScope: row.t.scope as 'read' | 'write',
    tokenId: row.t.id,
  };
}

export const isAdminRole = (role: string) => role === 'owner' || role === 'admin';

/**
 * Context by Bearer token or planar_sid cookie; null — not authorized.
 * The cloud trial is over (cloud-link) — null for everyone; with expiredAdmins owners and admins
 * pass (AuthGuard lets them only to the payment routes).
 * Without `states` an incomplete session (2FA pending or not set up) is null and a locked one is 423;
 * AuthGuard passes `states` and lets such sessions only to their /api/auth routes.
 */
export async function authenticateRaw(
  db: Db,
  headers: IncomingHttpHeaders,
  method: string,
  opts: { publicUrl: string; allowToken?: boolean; expiredAdmins?: boolean; states?: boolean },
  /** session was extended — the caller re-sets the cookie (the token is not part of AuthCtx) */
  onRenew?: (token: string) => void,
): Promise<AuthCtx | null> {
  if (cloudExpired() && !opts.expiredAdmins) return null;
  const ctx = await authenticateAny(db, headers, method, opts, onRenew);
  if (ctx?.state && !opts.states) {
    if (ctx.state === 'locked') throw lockedError();
    return null;
  }
  return ctx && cloudExpired() && !isAdminRole(ctx.role) ? null : ctx;
}

export const lockedError = () => new HttpError(423, 'locked', 'Приложение заблокировано');

/**
 * App lock without the client (tab closed, device taken): no requests for this long — locked;
 * null — no lock setting. «On every open» alone — 3 minutes.
 */
export const lockIdleMs = (lockMinutes: number | null, lockOnOpen: boolean | null) =>
  lockMinutes != null || lockOnOpen ? Math.max(lockMinutes ?? 0, 3) * 60_000 : null;

async function authenticateAny(
  db: Db,
  headers: IncomingHttpHeaders,
  method: string,
  opts: { publicUrl: string; allowToken?: boolean },
  onRenew?: (token: string) => void,
): Promise<AuthCtx | null> {
  const bearer = /^Bearer (plnr_\S+)$/i.exec(headers.authorization ?? '');
  if (bearer) return opts.allowToken === false ? null : authenticateBearer(db, bearer[1]!); // Origin is not checked for Bearer
  const token = readCookie(headers.cookie, SESSION_COOKIE);
  if (!token) return null;
  if (UNSAFE.has(method) && !allowedOrigins(opts.publicUrl).includes(headers.origin ?? '')) {
    throw new HttpError(403, 'origin_mismatch', 'Origin не совпадает с PUBLIC_URL');
  }
  const [row] = await db
    .select({
      s: sessions,
      role: users.role,
      deactivated: users.deactivatedAt,
      lockMinutes: userSecurity.lockMinutes,
      lockOnOpen: userSecurity.lockOnOpen,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(userSecurity, eq(userSecurity.userId, sessions.userId))
    .where(eq(sessions.id, hashToken(token)));
  if (!row) return null;
  if (row.deactivated) {
    await deleteUserSessions(db, row.s.userId);
    return null;
  }
  const left = Date.parse(row.s.expiresAt) - Date.now();
  if (left <= 0) {
    await deleteSession(db, token);
    return null;
  }
  // the idle check goes before lastSeenAt is touched: the lock is kept in lockedAt
  let locked = !!row.s.lockedAt;
  const idle = lockIdleMs(row.lockMinutes, row.lockOnOpen);
  if (
    !locked &&
    !row.s.state &&
    idle !== null &&
    Date.now() - Date.parse(row.s.lastSeenAt) > idle
  ) {
    locked = true;
    await db
      .update(sessions)
      .set({ lockedAt: sql`now()` })
      .where(eq(sessions.id, row.s.id));
  }
  const renew = left < 15 * DAY && !row.s.state;
  if (renew) {
    await db
      .update(sessions)
      .set({ expiresAt: sessionExpiry(), lastSeenAt: sql`now()` })
      .where(eq(sessions.id, row.s.id));
  } else {
    await db
      .update(sessions)
      .set({ lastSeenAt: sql`now()` })
      .where(
        and(eq(sessions.id, row.s.id), lt(sessions.lastSeenAt, sql`now() - interval '1 minute'`)),
      );
  }
  if (renew) onRenew?.(token);
  return {
    userId: row.s.userId,
    role: row.role as AuthCtx['role'],
    via: 'session',
    ...(row.s.state === 'mfa'
      ? { state: 'mfa' as const }
      : locked
        ? { state: 'locked' as const }
        : row.s.state === 'setup' && { state: 'setup' as const }),
  };
}

/** Request context after AuthGuard. */
export function getAuth(req: object): AuthCtx {
  const ctx = (req as { auth?: AuthCtx }).auth;
  if (!ctx) throw new HttpError(401, 'unauthenticated', 'Требуется вход');
  return ctx;
}
