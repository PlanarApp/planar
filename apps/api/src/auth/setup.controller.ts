import { timingSafeEqual } from 'node:crypto';
import { Body, Controller, Get, Headers, Inject, Post } from '@nestjs/common';
import { ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db/index.js';
import { users } from '../db/schema.js';
import { cloudExpired, cloudPublic, type CloudPublic } from '../cloud/cloud.js';
import { createHandoffSession } from './sessions.js';
import { DB } from '../tokens.js';
import { AUTH_OPTS, type AuthOpts } from './auth.js';
import { SYSTEM_LOGIN } from '../users/system.js';
import { insertUser } from '../users/users.repo.js';
import { loginSchema, passwordSchema } from '../users/users.controller.js';
import { publicUser } from './auth.controller.js';
import { HttpError } from './errors.js';
import { hashPassword } from './password.js';
import { Public } from './public.js';
import { parseBody } from './validate.js';
import { ensureRootSpace } from '../spaces/root.js';

const setupSchema = z.object({
  login: loginSchema,
  name: z.string().trim().min(1).max(200),
  password: passwordSchema,
  email: z.string().trim().email().max(320).optional(),
  /** cloud-link: one-time sign-in token (GET /api/auth/handoff), valid 10 minutes */
  loginToken: z.string().min(32).max(200).optional(),
});
const pick = (c: CloudPublic | null) => ({
  status: c?.status ?? null,
  trialEndsAt: c?.trialEndsAt ?? null,
});

@Controller('api/setup')
export class SetupController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AUTH_OPTS) private readonly opts: AuthOpts,
  ) {}

  /** the system user "Automation" is not counted */
  private async hasUsers(q: Pick<Db, 'select'>) {
    return (
      (await q.select({ id: users.id }).from(users).where(ne(users.login, SYSTEM_LOGIN)).limit(1))
        .length > 0
    );
  }

  @Public()
  @Get()
  async needed() {
    return {
      needed: !(await this.hasUsers(this.db)),
      tokenRequired: !!this.opts.setupToken,
      demo: !!this.opts.demo,
      demoResetHours: this.opts.demoResetHours ?? 24, // text of the web banner
      // cloud-link: the toolbar badge and the "trial is over" banner on the sign-in screen
      cloud: this.opts.cloud ? { ...pick(cloudPublic()), expired: cloudExpired() } : null,
    };
  }

  @Public()
  @Post()
  async setup(@Body() body: unknown, @Headers('x-setup-token') token?: string) {
    // checked before any DB query
    const want = this.opts.setupToken;
    if (want) {
      const a = Buffer.from(token ?? '');
      const b = Buffer.from(want);
      if (a.length !== b.length || !timingSafeEqual(a, b))
        throw new HttpError(403, 'forbidden', 'Неверный токен настройки');
    }
    const { password, loginToken, ...v } = parseBody(setupSchema, body);
    const passwordHash = await hashPassword(password);
    const row = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('planar:setup'))`);
      if (await this.hasUsers(tx)) {
        throw new HttpError(409, 'conflict', 'Настройка уже выполнена');
      }
      const u = await insertUser(tx, { ...v, role: 'owner', passwordHash });
      if (loginToken) await createHandoffSession(tx, u.id, loginToken);
      return u;
    });
    await ensureRootSpace(this.db); // owner is a member of "General" (Workspace)
    return { user: publicUser(row) };
  }
}
