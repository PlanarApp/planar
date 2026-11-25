import { eq } from 'drizzle-orm';
import { isDataModule, WORKSPACE_DATA_MODULE_IDS } from '@planar/shared';
import { HttpError } from '../../auth/errors.js';
import { publicUser } from '../../auth/auth.controller.js';
import * as s from '../../db/schema.js';
import { installed } from '../../modules/installed.js';
import type { ExtDeps } from './types.js';

export const forbidden = (m = 'Недостаточно прав') => new HttpError(403, 'forbidden', m);

/** instance owner or admin; the role is read from the DB (the token carries only the user) */
export async function requireAdmin(d: ExtDeps, userId: string) {
  const [u] = await d.db.select({ r: s.users.role }).from(s.users).where(eq(s.users.id, userId));
  if (u?.r !== 'owner' && u?.r !== 'admin') throw forbidden('Нужна роль admin инстанса');
  return u.r;
}

/** a user without secrets (password hash) */
export const userOut = (u: typeof s.users.$inferSelect) => publicUser(u);

export async function findUser(d: ExtDeps, id: string) {
  const ok = /^[0-9a-f-]{36}$/.test(id);
  const [u] = ok ? await d.db.select().from(s.users).where(eq(s.users.id, id)) : [];
  if (!u) throw new HttpError(404, 'not_found', 'Пользователь не найден');
  return u;
}

/** modules that the instance switches: shared ones and workspace switches of data modules */
const switchable = () =>
  installed
    .map((m) => m.api.id)
    .filter((id) => !isDataModule(id) || WORKSPACE_DATA_MODULE_IDS.includes(id));

export async function moduleList(d: ExtDeps) {
  const [r] = await d.db.select().from(s.settings).where(eq(s.settings.id, 'enabled_modules'));
  const on = new Set(Array.isArray(r?.value) ? (r.value as unknown[]) : []);
  return switchable().map((id) => ({ id, enabled: on.has(id) }));
}

/** new value of settings.enabled_modules; 400 for an unknown module */
export async function modulesWith(d: ExtDeps, id: string, enabled: boolean) {
  if (!switchable().includes(id))
    throw new HttpError(400, 'invalid_request', `Неизвестный модуль инстанса: ${id}`);
  const ids = (await moduleList(d)).filter((m) => m.enabled && m.id !== id).map((m) => m.id);
  return enabled ? [...ids, id] : ids;
}

export async function workspace(d: ExtDeps) {
  const [r] = await d.db.select().from(s.settings).where(eq(s.settings.id, 'workspace'));
  return (r?.value ?? {}) as { name?: string; color?: string; icon?: string; mfa?: string };
}
