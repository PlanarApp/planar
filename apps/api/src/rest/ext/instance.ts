import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { passkeys, userSecurity } from '../../db/schema.js';
import { hashPassword } from '../../auth/password.js';
import { deleteUserSessions } from '../../auth/sessions.js';
import { capSpaceRoles, ensureRootSpace, leaveAllSpaces } from '../../spaces/root.js';
import { ADMIN_BY_OWNER, loginSchema, passwordSchema } from '../../users/users.controller.js';
import { insertUser, listUsers, updateUser } from '../../users/users.repo.js';
import type { ExtArea, ExtOp } from './types.js';
import {
  findUser,
  forbidden,
  moduleList,
  modulesWith,
  requireAdmin,
  userOut,
  workspace,
} from './instance.service.js';

// PLNRAPP-272 (part 2): instance users, modules and workspace name; instance owner/admin only, no secrets in answers
const role = z.enum(['admin', 'member', 'guest']); // 'owner' cannot be assigned
const id = z.uuid();

const ops: ExtOp[] = [
  {
    tool: 'list_users',
    description:
      'Пользователи инстанса (только админ инстанса): id, логин, имя, email, роль, заблокирован',
    method: 'get',
    path: '/api/v1/instance/users',
    shape: {},
    write: false,
    run: async (d, u) => {
      await requireAdmin(d, u);
      return (await listUsers(d.db)).map(userOut);
    },
  },
  {
    tool: 'create_user',
    description:
      'Создать пользователя инстанса (только админ инстанса): логин, имя, пароль, роль (admin — только владелец; member/guest), email',
    method: 'post',
    path: '/api/v1/instance/users',
    shape: {
      login: loginSchema,
      name: z.string().trim().min(1).max(200),
      password: passwordSchema,
      role,
      email: z.string().email().optional(),
    },
    write: true,
    danger: 'delete', // admin power: the AI chat asks the user's «yes» (prompt injection)
    status: 201,
    run: async (d, u, i) => {
      const actor = await requireAdmin(d, u);
      const { password, ...v } = i as {
        password: string;
        login: string;
        name: string;
        role: string;
        email?: string;
      };
      if (v.role === 'admin' && actor !== 'owner') throw forbidden(ADMIN_BY_OWNER);
      const passwordHash = await hashPassword(password);
      const row = await d.db.transaction((q) => insertUser(q, { ...v, passwordHash }));
      await ensureRootSpace(d.db);
      return userOut(row);
    },
  },
  {
    tool: 'update_user',
    description:
      'Изменить пользователя инстанса (только админ инстанса): имя, email, роль (admin/member/guest; назначить admin может только владелец), блокировка (deactivated), сброс двухфакторной аутентификации (reset2fa: приложение-аутентификатор, резервные коды, passkey). Владельца и, не будучи владельцем, админа менять нельзя; себе роль, блокировку и 2FA менять нельзя',
    method: 'patch',
    path: '/api/v1/instance/users/{id}',
    shape: {
      id,
      name: z.string().trim().min(1).max(200).optional(),
      email: z.string().email().nullable().optional(),
      role: role.optional(),
      deactivated: z.boolean().optional(),
      reset2fa: z.literal(true).optional(),
    },
    write: true,
    danger: 'delete', // admin power: the AI chat asks the user's «yes» (prompt injection)
    run: async (d, u, i) => {
      const actor = await requireAdmin(d, u);
      const { id: tid, ...p } = i as {
        id: string;
        name?: string;
        email?: string | null;
        role?: string;
        deactivated?: boolean;
        reset2fa?: true;
      };
      const target = await findUser(d, tid);
      if (tid === u) {
        if (p.role !== undefined || p.deactivated !== undefined || p.reset2fa)
          throw forbidden('Себе можно менять только name и email');
      } else if (target.role === 'owner' || (target.role === 'admin' && actor !== 'owner'))
        throw forbidden();
      if (p.role === 'admin' && target.role !== 'admin' && actor !== 'owner')
        throw forbidden(ADMIN_BY_OWNER);
      const row = await d.db.transaction((q) =>
        updateUser(q, u, tid, {
          ...(p.name !== undefined && { name: p.name }),
          ...(p.email !== undefined && { email: p.email }),
          ...(p.role !== undefined && { role: p.role }),
          ...(p.deactivated !== undefined && {
            deactivatedAt: p.deactivated ? new Date().toISOString() : null,
          }),
        }),
      );
      if (p.role !== undefined || p.deactivated === false)
        await ensureRootSpace(d.db, p.role !== undefined ? tid : undefined);
      if (p.role === 'guest') await capSpaceRoles(d.db, tid);
      if (p.deactivated) {
        await leaveAllSpaces(d.db, tid);
        await deleteUserSessions(d.db, tid);
      }
      if (p.reset2fa) {
        await d.db.delete(userSecurity).where(eq(userSecurity.userId, tid));
        await d.db.delete(passkeys).where(eq(passkeys.userId, tid));
      }
      return userOut(row);
    },
  },
  {
    tool: 'get_instance',
    description:
      'Инстанс (только админ инстанса): имя workspace и модули инстанса (id, включён ли)',
    method: 'get',
    path: '/api/v1/instance',
    shape: {},
    write: false,
    run: async (d, u) => {
      await requireAdmin(d, u);
      return { workspace: await workspace(d), modules: await moduleList(d) };
    },
  },
  {
    tool: 'update_workspace',
    description:
      'Workspace инстанса (только админ инстанса): имя, политика двухфакторной аутентификации mfa — off (по желанию), admins (обязательна админам), all (обязательна всем)',
    method: 'patch',
    path: '/api/v1/instance/workspace',
    shape: {
      name: z.string().trim().min(1).max(100).optional(),
      mfa: z.enum(['off', 'admins', 'all']).optional(),
    },
    write: true,
    danger: 'delete', // admin power: the AI chat asks the user's «yes» (prompt injection)
    run: async (d, u, i, t) => {
      await requireAdmin(d, u);
      const p = i as { name?: string; mfa?: string };
      const value = {
        ...(await workspace(d)),
        ...(p.name !== undefined && { name: p.name }),
        ...(p.mfa !== undefined && { mfa: p.mfa }),
      };
      await d.run(u, [{ name: 'settings.set', args: { id: 'workspace', value } }], t);
      return workspace(d);
    },
  },
  {
    tool: 'set_instance_module',
    description:
      'Включить или выключить общий модуль инстанса (только админ инстанса); модули данных включаются в проекте',
    method: 'put',
    path: '/api/v1/instance/modules/{id}',
    shape: { id: z.string().min(1), enabled: z.boolean() },
    write: true,
    danger: 'delete', // admin power: the AI chat asks the user's «yes» (prompt injection)
    run: async (d, u, i, t) => {
      await requireAdmin(d, u);
      const a = i as { id: string; enabled: boolean };
      const value = await modulesWith(d, a.id, a.enabled);
      await d.run(u, [{ name: 'settings.set', args: { id: 'enabled_modules', value } }], t);
      return (await moduleList(d)).find((m) => m.id === a.id);
    },
  },
];

export const area: ExtArea = { name: 'instance', ops };
