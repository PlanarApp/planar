import { z } from 'zod';
import { hashPassword } from '../../auth/password.js';
import { deleteUserSessions } from '../../auth/sessions.js';
import { ensureRootSpace } from '../../spaces/root.js';
import { loginSchema, passwordSchema } from '../../users/users.controller.js';
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
      'Создать пользователя инстанса (только админ инстанса): логин, имя, пароль, роль (admin/member/guest), email',
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
    status: 201,
    run: async (d, u, i) => {
      await requireAdmin(d, u);
      const { password, ...v } = i as {
        password: string;
        login: string;
        name: string;
        role: string;
        email?: string;
      };
      const passwordHash = await hashPassword(password);
      const row = await d.db.transaction((q) => insertUser(q, { ...v, passwordHash }));
      await ensureRootSpace(d.db);
      return userOut(row);
    },
  },
  {
    tool: 'update_user',
    description:
      'Изменить пользователя инстанса (только админ инстанса): имя, email, роль (admin/member/guest), блокировка (deactivated). Владельца и, не будучи владельцем, админа менять нельзя; себе роль и блокировку менять нельзя',
    method: 'patch',
    path: '/api/v1/instance/users/{id}',
    shape: {
      id,
      name: z.string().trim().min(1).max(200).optional(),
      email: z.string().email().nullable().optional(),
      role: role.optional(),
      deactivated: z.boolean().optional(),
    },
    write: true,
    run: async (d, u, i) => {
      const actor = await requireAdmin(d, u);
      const { id: tid, ...p } = i as {
        id: string;
        name?: string;
        email?: string | null;
        role?: string;
        deactivated?: boolean;
      };
      const target = await findUser(d, tid);
      if (tid === u) {
        if (p.role !== undefined || p.deactivated !== undefined)
          throw forbidden('Себе можно менять только name и email');
      } else if (target.role === 'owner' || (target.role === 'admin' && actor !== 'owner'))
        throw forbidden();
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
      if (p.role !== undefined || p.deactivated === false) await ensureRootSpace(d.db);
      if (p.deactivated) await deleteUserSessions(d.db, tid);
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
    description: 'Переименовать workspace инстанса (только админ инстанса)',
    method: 'patch',
    path: '/api/v1/instance/workspace',
    shape: { name: z.string().trim().min(1).max(100) },
    write: true,
    run: async (d, u, i, t) => {
      await requireAdmin(d, u);
      const value = { ...(await workspace(d)), name: (i as { name: string }).name };
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
