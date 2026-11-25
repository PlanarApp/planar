import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { passkeys, sessions, userSecurity, users } from '../db/schema.js';
import { DB } from '../tokens.js';
import { publicUser } from './auth.controller.js';
import { AUTH_OPTS, authenticateRaw, getAuth, readCookie, type AuthOpts } from './auth.js';
import { HttpError } from './errors.js';
import { assertNotLimited, recordFailure, resetAttempts } from './login-limit.js';
import {
  factors,
  finishSetup,
  mfaPolicy,
  policyApplies,
  relyingParty,
  saveChallenge,
  securityOf,
  takeChallenge,
  verifyFactor,
  verifyPasskey,
  type FactorProof,
} from './mfa.js';
import { Public } from './public.js';
import { SESSION_COOKIE, createSession, hashToken, sessionCookie } from './sessions.js';
import { hashRecovery, newRecoveryCodes, newTotpSecret, totpUri, verifyTotp } from './totp.js';
import { parseBody } from './validate.js';

const ISSUER = 'Planar';
const code = z.object({ code: z.string().min(6).max(20) });
const assertion = z.object({
  challengeId: z.string().max(100),
  response: z.looseObject({ id: z.string().max(1024) }),
});
const proof = z.union([code, assertion]);
const lockBody = z.object({
  lockMinutes: z.union([z.literal(0), z.literal(5), z.literal(15), z.literal(60)]).nullable(),
  lockWipe: z.boolean(),
});

const setSecurity = (db: Db, userId: string, v: Partial<typeof userSecurity.$inferInsert>) =>
  db
    .insert(userSecurity)
    .values({ userId, ...v })
    .onConflictDoUpdate({ target: userSecurity.userId, set: { ...v, updatedAt: sql`now()` } });

/** 2FA (TOTP, recovery codes, passkeys) and app lock — docs in apps/api/src/auth/mfa.ts. */
@Controller('api/auth')
export class MfaController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AUTH_OPTS) private readonly opts: AuthOpts,
  ) {}

  private rp(req: FastifyRequest) {
    return relyingParty(req.headers.origin, this.opts.publicUrl);
  }

  private token(req: FastifyRequest) {
    return hashToken(readCookie(req.headers.cookie, SESSION_COOKIE) ?? '');
  }

  private session(req: FastifyRequest) {
    const me = getAuth(req);
    if (me.via !== 'session') throw new HttpError(403, 'forbidden', 'Только из сессии браузера');
    return me;
  }

  /** The last factor is gone: nothing to unlock with — the lock is off, recovery codes too. */
  private async afterRemoval(userId: string) {
    const f = await factors(this.db, userId);
    if (!f.totp && !f.passkey)
      await setSecurity(this.db, userId, { lockMinutes: null, recoveryCodes: [] });
  }

  @Get('security')
  async security(@Req() req: FastifyRequest) {
    const me = this.session(req);
    const s = await securityOf(this.db, me.userId);
    const keys = await this.db
      .select({
        id: passkeys.id,
        name: passkeys.name,
        createdAt: passkeys.createdAt,
        lastUsedAt: passkeys.lastUsedAt,
      })
      .from(passkeys)
      .where(eq(passkeys.userId, me.userId))
      .orderBy(desc(passkeys.createdAt));
    return {
      totp: !!s?.totpEnabled,
      recoveryLeft: s?.recoveryCodes.length ?? 0,
      passkeys: keys,
      lockMinutes: s?.lockMinutes ?? null,
      lockWipe: s?.lockWipe ?? false,
      required: policyApplies(await mfaPolicy(this.db), me.role),
      setup: me.state === 'setup',
    };
  }

  @Post('totp/setup')
  @HttpCode(200)
  async totpSetup(@Req() req: FastifyRequest) {
    const me = this.session(req);
    if ((await securityOf(this.db, me.userId))?.totpEnabled)
      throw new HttpError(409, 'conflict', 'Приложение-аутентификатор уже подключено');
    const [u] = await this.db.select().from(users).where(eq(users.id, me.userId));
    const secret = newTotpSecret();
    await setSecurity(this.db, me.userId, { totpSecret: secret, totpEnabled: false });
    const uri = totpUri(secret, u!.login, ISSUER);
    return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 200 }) };
  }

  /** Confirms the secret with a code → TOTP on; returns new recovery codes (shown once). */
  @Post('totp/enable')
  @HttpCode(200)
  async totpEnable(@Req() req: FastifyRequest, @Body() body: unknown) {
    const me = this.session(req);
    const b = parseBody(code, body);
    const s = await securityOf(this.db, me.userId);
    if (!s?.totpSecret || s.totpEnabled)
      throw new HttpError(409, 'conflict', 'Сначала начните подключение');
    const key = `mfa|${me.userId}`;
    await assertNotLimited(this.db, key);
    const step = verifyTotp(s.totpSecret, b.code.replace(/\s/g, ''), null);
    if (step === null) {
      await recordFailure(this.db, key);
      throw new HttpError(401, 'invalid_credentials', 'Неверный код');
    }
    await resetAttempts(this.db, key);
    const codes = newRecoveryCodes();
    await setSecurity(this.db, me.userId, {
      totpEnabled: true,
      totpStep: step,
      recoveryCodes: codes.map(hashRecovery),
    });
    await finishSetup(this.db, me.userId);
    return { recoveryCodes: codes };
  }

  @Post('totp/disable')
  @HttpCode(204)
  async totpDisable(@Req() req: FastifyRequest, @Body() body: unknown) {
    const me = this.session(req);
    await verifyFactor(this.db, me.userId, parseBody(code, body), () => this.rp(req));
    await this.guardLast(me.userId, me.role, 'totp');
    await setSecurity(this.db, me.userId, { totpSecret: null, totpEnabled: false, totpStep: null });
    await this.afterRemoval(me.userId);
  }

  @Post('recovery-codes')
  @HttpCode(200)
  async recoveryCodes(@Req() req: FastifyRequest, @Body() body: unknown) {
    const me = this.session(req);
    await verifyFactor(this.db, me.userId, parseBody(proof, body) as FactorProof, () =>
      this.rp(req),
    );
    const codes = newRecoveryCodes();
    await setSecurity(this.db, me.userId, { recoveryCodes: codes.map(hashRecovery) });
    return { recoveryCodes: codes };
  }

  @Post('passkeys/options')
  @HttpCode(200)
  async passkeyRegisterOptions(@Req() req: FastifyRequest) {
    const me = this.session(req);
    const { rpID } = this.rp(req);
    const [u] = await this.db.select().from(users).where(eq(users.id, me.userId));
    const own = await this.db
      .select({ id: passkeys.id, transports: passkeys.transports })
      .from(passkeys)
      .where(eq(passkeys.userId, me.userId));
    const options = await generateRegistrationOptions({
      rpName: ISSUER,
      rpID,
      userName: u!.login,
      userDisplayName: u!.name,
      userID: new TextEncoder().encode(u!.id),
      attestationType: 'none',
      excludeCredentials: own.map((k) => ({ id: k.id, transports: k.transports ?? undefined })),
      // discoverable — passwordless sign-in; verification — biometrics or the device PIN
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    return { challengeId: await saveChallenge(this.db, options.challenge, me.userId), options };
  }

  @Post('passkeys')
  @HttpCode(201)
  async passkeyRegister(@Req() req: FastifyRequest, @Body() body: unknown) {
    const me = this.session(req);
    const b = parseBody(assertion.extend({ name: z.string().trim().min(1).max(100) }), body);
    const rp = this.rp(req);
    const challenge = await takeChallenge(this.db, b.challengeId, me.userId);
    const r = await verifyRegistrationResponse({
      response: b.response as never,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    }).catch(() => null);
    if (!r?.verified) throw new HttpError(400, 'invalid_request', 'Ключ не подтверждён');
    const cred = r.registrationInfo.credential;
    const [row] = await this.db
      .insert(passkeys)
      .values({
        id: cred.id,
        userId: me.userId,
        name: b.name,
        publicKey: Buffer.from(cred.publicKey).toString('base64url'),
        counter: cred.counter,
        transports: cred.transports ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new HttpError(409, 'conflict', 'Этот ключ уже добавлен');
    await finishSetup(this.db, me.userId);
    return { id: row.id, name: row.name, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt };
  }

  @Delete('passkeys/:id')
  @HttpCode(204)
  async passkeyDelete(@Req() req: FastifyRequest, @Param('id') id: string) {
    const me = this.session(req);
    await this.guardLast(me.userId, me.role, 'passkey', id);
    await this.db.delete(passkeys).where(and(eq(passkeys.id, id), eq(passkeys.userId, me.userId)));
    await this.afterRemoval(me.userId);
  }

  /** Under the policy the last factor stays: 409. */
  private async guardLast(userId: string, role: string, kind: 'totp' | 'passkey', keyId?: string) {
    if (!policyApplies(await mfaPolicy(this.db), role)) return;
    const f = await factors(this.db, userId);
    const keys = await this.db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.userId, userId));
    const left = (kind === 'totp' ? 0 : +f.totp) + keys.filter((k) => k.id !== keyId).length;
    if (left === 0)
      throw new HttpError(409, 'conflict', 'Двухфакторная аутентификация обязательна');
  }

  @Patch('lock')
  async lockSettings(@Req() req: FastifyRequest, @Body() body: unknown) {
    const me = this.session(req);
    const b = parseBody(lockBody, body);
    const f = await factors(this.db, me.userId);
    if (b.lockMinutes !== null && !f.totp && !f.passkey)
      throw new HttpError(
        409,
        'conflict',
        'Сначала подключите passkey или приложение-аутентификатор',
      );
    await setSecurity(this.db, me.userId, b);
    return b;
  }

  /** The client locks the app (idle, on open): the session waits for unlock. */
  @Post('lock')
  @HttpCode(204)
  async lock(@Req() req: FastifyRequest) {
    const me = this.session(req);
    // without the lock setting there may be nothing to unlock with
    if ((await securityOf(this.db, me.userId))?.lockMinutes == null) return;
    await this.db
      .update(sessions)
      .set({ lockedAt: sql`now()` })
      .where(eq(sessions.id, this.token(req)));
  }

  @Post('unlock')
  @HttpCode(204)
  async unlock(@Req() req: FastifyRequest, @Body() body: unknown) {
    const me = this.session(req);
    await verifyFactor(this.db, me.userId, parseBody(proof, body) as FactorProof, () =>
      this.rp(req),
    );
    await this.db
      .update(sessions)
      .set({ lockedAt: null, lastSeenAt: sql`now()` })
      .where(eq(sessions.id, this.token(req)));
  }

  /** Second factor after the password: the 'mfa' session is replaced by a full one. */
  @Post('mfa/verify')
  @HttpCode(200)
  async mfaVerify(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() body: unknown,
  ) {
    const me = this.session(req);
    if (me.state !== 'mfa') throw new HttpError(409, 'conflict', 'Второй фактор не требуется');
    await verifyFactor(this.db, me.userId, parseBody(proof, body) as FactorProof, () =>
      this.rp(req),
    );
    await this.db.delete(sessions).where(eq(sessions.id, this.token(req)));
    return this.start(req, res, me.userId);
  }

  /** Assertion options: for a signed-in (2FA pending, locked) session — its keys; otherwise any discoverable key. */
  @Public()
  @Post('passkey/options')
  @HttpCode(200)
  async passkeyOptions(@Req() req: FastifyRequest) {
    const { rpID } = this.rp(req);
    const me = await authenticateRaw(this.db, req.headers, req.method, {
      ...this.opts,
      allowToken: false,
      states: true,
    }).catch(() => null);
    const own = me
      ? await this.db
          .select({ id: passkeys.id, transports: passkeys.transports })
          .from(passkeys)
          .where(eq(passkeys.userId, me.userId))
      : [];
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'required',
      allowCredentials: own.map((k) => ({ id: k.id, transports: k.transports ?? undefined })),
    });
    const challengeId = await saveChallenge(this.db, options.challenge, me?.userId ?? null);
    return { challengeId, options };
  }

  /** Passwordless sign-in: a passkey with user verification is two factors by itself. */
  @Public()
  @Post('passkey/login')
  @HttpCode(200)
  async passkeyLogin(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() body: unknown,
  ) {
    const b = parseBody(assertion, body);
    const key = `${req.ip}|passkey`;
    await assertNotLimited(this.db, key);
    const userId = await verifyPasskey(this.db, this.rp(req), b as never, null);
    const [u] = userId ? await this.db.select().from(users).where(eq(users.id, userId)) : [];
    if (!u || u.deactivatedAt || u.bot) {
      await recordFailure(this.db, key);
      throw new HttpError(401, 'invalid_credentials', 'Ключ не подошёл');
    }
    await resetAttempts(this.db, key);
    return this.start(req, res, u.id);
  }

  private async start(req: FastifyRequest, res: FastifyReply, userId: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    const token = await createSession(this.db, userId, req.headers['user-agent']);
    void res.header('set-cookie', sessionCookie(token, { secure: this.opts.cookieSecure }));
    return { user: publicUser(u!) };
  }
}
