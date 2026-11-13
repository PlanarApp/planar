import { eq } from 'drizzle-orm';
import { DATA_MODULE_IDS, isDataModule, WORKSPACE_DATA_MODULE_IDS } from '@planar/shared';
import type { Db } from '../db/index.js';
import { projects, settings, tasks } from '../db/schema.js';
import { installed } from './installed.js';

/** Db or transaction. */
export type Reader = Pick<Db, 'select'>;

/**
 * Modules that work on the instance: shared ones from settings.enabled_modules (read on every request,
 * no cache, so a change takes effect at once) and data modules, which are always installed (C-schema v16):
 * whether a data module works in a project is `projects.modules` (see projectModules). A data module with a
 * workspace switch (WORKSPACE_DATA_MODULE_IDS) works only when that switch is on too (PLNRAPP-241).
 */
export async function enabledModules(q: Reader): Promise<Set<string>> {
  const [r] = await q.select().from(settings).where(eq(settings.id, 'enabled_modules'));
  const v = r?.value;
  const ids = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  const data = DATA_MODULE_IDS.filter((id) => !WORKSPACE_DATA_MODULE_IDS.includes(id));
  return new Set([...ids, ...data].filter((id) => installed.some((m) => m.api.id === id)));
}

/** Data modules enabled for the project; null — no such project. */
export async function projectModules(q: Reader, projectId: string): Promise<Set<string> | null> {
  const [p] = await q
    .select({ m: projects.modules })
    .from(projects)
    .where(eq(projects.id, projectId));
  return p ? new Set(p.m) : null;
}

/** Shared modules are not per project (true); a data module — whether it is on in the project. */
export async function moduleOnInProject(
  q: Reader,
  moduleId: string,
  projectId: string,
): Promise<boolean> {
  if (!isDataModule(moduleId)) return true;
  return (await projectModules(q, projectId))?.has(moduleId) ?? false;
}

/** Project of a written row: its projectId, or the project of its task; projects themselves — own id. null — not tied to a project. */
export async function projectOfRow(
  q: Reader,
  entity: string,
  row: Record<string, unknown>,
  cache: Map<string, string | null> = new Map(),
): Promise<string | null> {
  if (entity === 'projects') return row.id as string;
  if (typeof row.projectId === 'string') return row.projectId;
  if (typeof row.taskId !== 'string') return null;
  if (!cache.has(row.taskId)) {
    const [t] = await q.select({ p: tasks.projectId }).from(tasks).where(eq(tasks.id, row.taskId));
    cache.set(row.taskId, t?.p ?? null);
  }
  return cache.get(row.taskId) ?? null;
}
