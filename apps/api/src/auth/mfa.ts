import { randomBytes } from 'node:crypto';
import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import { and, count, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { authChallenges, passkeys, sessions, settings, userSecurity, users } from '../db/schema.js';
import { allowedOrigins, isAdminRole } from './auth.js';
import { HttpError } from './errors.js';
import { countAttempt, resetAttempts } from './login-limit.js';
import { hashRecovery, verifyTotp } from './totp.js';

export type MfaPolicy = 'off' | 'admins' | 'all';

export async function mfaPolicy(db: Db): Promise<MfaPolicy> {
  const [r] = await db.select().from(settings).where(eq(settings.id, 'workspace'));
  const v = (r?.value as { mfa?: unknown } | undefined)?.mfa;
  return v === 'admins' || v === 'all' ? v : 'off';
}

export const policyApplies = (p: MfaPolicy, role: string) =>
  p === 'all' || (p === 'admins' && isAdminRole(role));

export async function securityOf(db: Db, userId: string) {
  const [r] = await db.select().from(userSecurity).where(eq(userSecurity.userId, userId));
  return r;
}

/** Second factors the user has set up. */
export async function factors(db: Db, userId: string) {
  const s = await securityOf(db, userId);
  const [p] = await db.select({ n: count() }).from(passkeys).where(eq(passkeys.userId, userId));
  return { totp: !!s?.totpEnabled, passkey: p!.n > 0 };
}

/** Session state after the password: second factor, forced setup or a full session. */
export async function stateAfterPassword(
  db: Db,
  user: typeof users.$inferSelect,
): Promise<'mfa' | 'setup' | null> {
  const f = await factors(db, user.id);
  if (f.totp || f.passkey) return 'mfa';
  return policyApplies(await mfaPolicy(db), user.role) ? 'setup' : null;
}

/** The user set up the first factor: sessions waiting for setup become full. */
export const finishSetup = (db: Db, userId: string) =>
  db
    .update(sessions)
    .set({ state: null })
    .where(and(eq(sessions.userId, userId), eq(sessions.state, 'setup')));

/** WebAuthn relying party: the request Origin must be one of the instance origins. */
export function relyingParty(origin: string | undefined, publicUrl: string) {
  if (!origin || !allowedOrigins(publicUrl).includes(origin))
    throw new HttpError(403, 'origin_mismatch', 'Origin не совпадает с PUBLIC_URL');
  return { origin, rpID: new URL(origin).hostname };
}

const CHALLENGE_MS = 5 * 60_000;

export async function saveChallenge(db: Db, challenge: string, userId: string | null) {
  const id = randomBytes(16).toString('base64url');
  await db.insert(authChallenges).values({
    id,
    challenge,
    userId,
    expiresAt: new Date(Date.now() + CHALLENGE_MS).toISOString(),
  });
  return id;
}

/** One use: the challenge is deleted on read; userId must match (null — passwordless sign-in). */
export async function takeChallenge(db: Db, id: string, userId: string | null) {
  const [c] = await db
    .delete(authChallenges)
    .where(
      and(
        eq(authChallenges.id, id),
        userId ? eq(authChallenges.userId, userId) : isNull(authChallenges.userId),
        gt(authChallenges.expiresAt, sql`now()`),
      ),
    )
    .returning();
  if (!c) throw new HttpError(400, 'invalid_request', 'Запрос устарел, повторите');
  return c.challenge;
}

export type PasskeyProof = { challengeId: string; response: AuthenticationResponseJSON };

/** Verified passkey assertion → owner id (userId given — the key must be theirs). */
export async function verifyPasskey(
  db: Db,
  rp: { origin: string; rpID: string },
  p: PasskeyProof,
  userId: string | null,
): Promise<string | null> {
  const challenge = await takeChallenge(db, p.challengeId, userId);
  const [key] = await db.select().from(passkeys).where(eq(passkeys.id, p.response.id));
  if (!key || (userId && key.userId !== userId)) return null;
  const r = await verifyAuthenticationResponse({
    response: p.response,
    expectedChallenge: challenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
    credential: {
      id: key.id,
      publicKey: Buffer.from(key.publicKey, 'base64url'),
      counter: key.counter,
      transports: (key.transports ?? undefined) as never,
    },
  }).catch(() => null);
  if (!r?.verified) return null;
  await db
    .update(passkeys)
    .set({ counter: r.authenticationInfo.newCounter, lastUsedAt: sql`now()` })
    .where(eq(passkeys.id, key.id));
  return key.userId;
}

/** TOTP code or an unused recovery code (spent on use). */
async function verifyCode(db: Db, userId: string, code: string): Promise<boolean> {
  const s = await securityOf(db, userId);
  if (!s) return false;
  const c = code.replace(/\s/g, '');
  if (s.totpEnabled && s.totpSecret) {
    const step = verifyTotp(s.totpSecret, c, s.totpStep);
    if (step !== null) {
      await db.update(userSecurity).set({ totpStep: step }).where(eq(userSecurity.userId, userId));
      return true;
    }
  }
  const h = hashRecovery(c);
  if (c.length < 8 || !s.recoveryCodes.includes(h)) return false;
  await db
    .update(userSecurity)
    .set({ recoveryCodes: s.recoveryCodes.filter((x) => x !== h) })
    .where(eq(userSecurity.userId, userId));
  return true;
}

export type FactorProof = { code: string } | PasskeyProof;

/** Second factor of a signed-in user: code or passkey; 10 failures a minute → 429. */
export async function verifyFactor(
  db: Db,
  userId: string,
  proof: FactorProof,
  rp: () => { origin: string; rpID: string },
): Promise<void> {
  const key = `mfa|${userId}`;
  await countAttempt(db, key);
  const ok =
    'code' in proof
      ? await verifyCode(db, userId, proof.code)
      : (await verifyPasskey(db, rp(), proof, userId)) === userId;
  if (!ok) {
    throw new HttpError(401, 'invalid_credentials', 'Неверный код');
  }
  await resetAttempts(db, key);
}
