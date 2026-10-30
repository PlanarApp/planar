import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { z } from 'zod';
import { AUTH_OPTS, getAuth, readCookie, type AuthOpts } from '../auth/auth.js';
import { publicUser } from '../auth/auth.controller.js';
import { HttpError } from '../auth/errors.js';
import { hashPassword } from '../auth/password.js';
import { SESSION_COOKIE, deleteOtherSessions, deleteUserSessions } from '../auth/sessions.js';
import type { FastifyRequest } from 'fastify';
import { parseBody } from '../auth/validate.js';
import type { Db } from '../db/index.js';
import { DB } from '../tokens.js';
import { ensureRootSpace } from '../spaces/root.js';
import { findUser, hasFileUpload, insertUser, listUsers, updateUser } from './users.repo.js';

export const loginSchema = z
  .string()
  .transform((s) => s.toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9._-]{2,32}$/));
export const passwordSchema = z.string().min(8).max(256);
const roleSchema = z.enum(['admin', 'member', 'guest']); // 'owner' cannot be assigned

const createSchema = z.object({
  login: loginSchema,
  name: z.string().trim().min(1).max(200),
  password: passwordSchema,
  role: roleSchema,
  email: z.string().email().optional(),
});
const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  email: z.string().email().nullable().optional(),
  role: roleSchema.optional(),
  password: passwordSchema.optional(),
  deactivated: z.boolean().optional(),
  avatarFile: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable()
    .optional(),
});

const forbidden = (m = 'Недостаточно прав') => new HttpError(403, 'forbidden', m);
const isAdmin = (role: string) => role === 'owner' || role === 'admin';

@Controller('api/users')
export class UsersController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AUTH_OPTS) private readonly auth: AuthOpts,
  ) {}

  @Get()
  async list(@Req() req: object) {
    if (!isAdmin(getAuth(req).role)) throw forbidden();
    return { users: (await listUsers(this.db)).map(publicUser) };
  }

  @Post()
  async create(@Req() req: object, @Body() body: unknown) {
    if (!isAdmin(getAuth(req).role)) throw forbidden();
    const { password, ...v } = parseBody(createSchema, body);
    const passwordHash = await hashPassword(password);
    const row = await this.db.transaction((q) => insertUser(q, { ...v, passwordHash }));
    await ensureRootSpace(this.db); // a new user is a member of "General" (Workspace)
    return { user: publicUser(row) };
  }

  @Patch(':id')
  @HttpCode(200)
  async patch(@Req() req: object, @Param('id') id: string, @Body() body: unknown) {
    const actor = getAuth(req);
    const self = actor.userId === id;
    if (!self && !isAdmin(actor.role)) throw forbidden();
    const p = parseBody(patchSchema, body);
    if (self && (p.role !== undefined || p.deactivated !== undefined)) {
      throw forbidden('Себе можно менять только name, email, password, avatarFile');
    }
    if (!/^[0-9a-f-]{36}$/.test(id))
      throw new HttpError(404, 'not_found', 'Пользователь не найден');
    const target = await findUser(this.db, id);
    if (!target) throw new HttpError(404, 'not_found', 'Пользователь не найден');
    if (!self && (target.role === 'owner' || (target.role === 'admin' && actor.role !== 'owner'))) {
      throw forbidden();
    }
    if (p.avatarFile && !(await hasFileUpload(this.db, p.avatarFile, id))) {
      throw new HttpError(400, 'invalid_request', 'avatarFile не загружен этим пользователем');
    }
    if (
      this.auth.demo &&
      target.login === 'demo' &&
      (p.password !== undefined || p.email !== undefined)
    )
      throw forbidden('В демо-режиме пароль и email пользователя demo менять нельзя');
    const passwordHash = p.password !== undefined ? await hashPassword(p.password) : undefined;
    const row = await this.db.transaction((q) =>
      updateUser(q, actor.userId, id, {
        ...(p.name !== undefined && { name: p.name }),
        ...(p.email !== undefined && { email: p.email }),
        ...(p.role !== undefined && { role: p.role }),
        ...(p.avatarFile !== undefined && { avatarFile: p.avatarFile }),
        ...(p.deactivated !== undefined && {
          deactivatedAt: p.deactivated ? new Date().toISOString() : null,
        }),
        ...(passwordHash && { passwordHash }),
      }),
    );
    if (p.role !== undefined || p.deactivated === false) await ensureRootSpace(this.db);
    if (p.deactivated) await deleteUserSessions(this.db, id);
    else if (p.password !== undefined) {
      // own — all sessions except the current one; someone else's — all
      const keep = self ? readCookie((req as FastifyRequest).headers.cookie, SESSION_COOKIE) : null;
      await deleteOtherSessions(this.db, id, keep);
    }
    return { user: publicUser(row) };
  }
}
