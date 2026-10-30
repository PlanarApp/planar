import type { IncomingHttpHeaders } from 'node:http';
import { and, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { apiTokens, sessions, users } from '../db/schema.js';
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
};

export const AUTH_OPTS = Symbol('AUTH_OPTS');
export type AuthOpts = {
  publicUrl: string;
  cookieSecure: boolean;
  setupToken?: string;
  demo?: boolean;
  demoResetHours?: number;
};

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'UPGRADE']);

/** Allowed Origins: PUBLIC_URL and EXTRA_ORIGINS (comma-separated; e.g. 127.0.0.1 next to localhost in dev). */
export function allowedOrigins(
  publicUrl: string,
  extra = process.env.EXTRA_ORIGINS ?? '',
): string[] {
  const list = [publicUrl, ...extra.split(',')].map((u) => u.trim()).filter(Boolean);
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

/** Context by Bearer token or planar_sid cookie; null — not authorized. */
export async function authenticateRaw(
  db: Db,
  headers: IncomingHttpHeaders,
  method: string,
  opts: { publicUrl: string; allowToken?: boolean },
  /** session was extended — the caller re-sets the cookie (the token is not part of AuthCtx) */
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
    .select({ s: sessions, role: users.role, deactivated: users.deactivatedAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
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
  const renew = left < 15 * DAY;
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
  };
}

/** Request context after AuthGuard. */
export function getAuth(req: object): AuthCtx {
  const ctx = (req as { auth?: AuthCtx }).auth;
  if (!ctx) throw new HttpError(401, 'unauthenticated', 'Требуется вход');
  return ctx;
}
