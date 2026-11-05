import { createHash, randomBytes } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { sessions } from '../db/schema.js';

export const SESSION_COOKIE = 'planar_sid';
export const SESSION_DAYS = 30;
const MAX_AGE = SESSION_DAYS * 86400;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const sessionExpiry = () => new Date(Date.now() + MAX_AGE * 1000).toISOString();

export async function createSession(db: Db, userId: string, userAgent?: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await db
    .insert(sessions)
    .values({ id: hashToken(token), userId, expiresAt: sessionExpiry(), userAgent });
  return token;
}

/** cloud-link: one-time sign-in token (GET /api/auth/handoff exchanges it for a normal session). */
export const HANDOFF_MS = 10 * 60_000;
/** userAgent of the setup handoff session (never a browser's): after the exchange — the sign-in hint */
export const SETUP_HANDOFF = 'planar:setup';
export async function createHandoffSession(
  db: Pick<Db, 'insert'>,
  userId: string,
  token = randomBytes(32).toString('base64url'),
  userAgent?: string,
): Promise<string> {
  await db.insert(sessions).values({
    id: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + HANDOFF_MS).toISOString(),
    userAgent,
  });
  return token;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export async function deleteUserSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

const base = (secure: boolean) => `Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;

export const sessionCookie = (token: string, { secure }: { secure: boolean }) =>
  `${SESSION_COOKIE}=${token}; ${base(secure)}; Max-Age=${MAX_AGE}`;

export const clearSessionCookie = ({ secure }: { secure: boolean }) =>
  `${SESSION_COOKIE}=; ${base(secure)}; Max-Age=0`;

/** All user sessions except the one with token keepToken. */
export async function deleteOtherSessions(db: Db, userId: string, keepToken: string | null) {
  await db
    .delete(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        keepToken ? ne(sessions.id, hashToken(keepToken)) : undefined,
      ),
    );
}
