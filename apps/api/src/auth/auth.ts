import type { IncomingHttpHeaders } from 'node:http';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { sessions, users } from '../db/schema.js';
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
};

export const AUTH_OPTS = Symbol('AUTH_OPTS');
export type AuthOpts = { publicUrl: string; cookieSecure: boolean };

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE', 'UPGRADE']);
const DAY = 86400_000;

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

/** Контекст по cookie planar_sid (Bearer — CR-10, пока null); null — не авторизован. */
export async function authenticateRaw(
  db: Db,
  headers: IncomingHttpHeaders,
  method: string,
  opts: { publicUrl: string },
  /** сессию продлили — вызывающий переустанавливает cookie (токен не входит в AuthCtx) */
  onRenew?: (token: string) => void,
): Promise<AuthCtx | null> {
  const token = readCookie(headers.cookie, SESSION_COOKIE);
  if (!token) return null; // shortcut: Bearer plnr_… не разбираем, делает CR-10
  if (UNSAFE.has(method) && headers.origin !== new URL(opts.publicUrl).origin) {
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

/** Контекст запроса после AuthGuard. */
export function getAuth(req: object): AuthCtx {
  const ctx = (req as { auth?: AuthCtx }).auth;
  if (!ctx) throw new HttpError(401, 'unauthenticated', 'Требуется вход');
  return ctx;
}
