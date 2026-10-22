import { Controller, Get, Inject, Req } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { users } from '../db/schema.js';
import { DB } from '../tokens.js';
import { getAuth } from './auth.js';

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
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get('me')
  async me(@Req() req: object) {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, getAuth(req).userId));
    return { user: publicUser(user!) };
  }
}
