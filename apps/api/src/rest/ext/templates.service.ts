import { and, asc, eq } from 'drizzle-orm';
import { templateIdPlan, type TemplateKind } from '@planar/module-templates/shared';
import { uuidv7 } from '@planar/shared';
import { HttpError } from '../../auth/errors.js';
import * as s from '../../db/schema.js';
import { cols, lastRank, rawRow, visibleSpaceOf, wireRow } from './planning.service.js';
import type { ExtDeps } from './types.js';

/** a template of a space where the user is a member; else 404 (templates is a data module: gated per project) */
export async function templateOf(d: ExtDeps, userId: string, id: string, kind?: TemplateKind) {
  const r = await rawRow(d, 'templatesTemplates', id);
  if (!r) throw new HttpError(404, 'not_found', 'Шаблон не найден');
  await visibleSpaceOf(d, userId, r.spaceId as string, 'Шаблон');
  if (kind && r.kind !== kind)
    throw new HttpError(
      400,
      'invalid_request',
      `Шаблон не для ${kind === 'task' ? 'задачи' : 'проекта'}`,
    );
  return r;
}

export const templateWire = (d: ExtDeps, id: string) => wireRow(d, 'templatesTemplates', id);

/** ids for a template, as many as the mutators consume */
export const freshIds = (kind: TemplateKind, data: unknown) =>
  Array.from({ length: templateIdPlan(kind, data).count }, () => uuidv7());

export const today = () => new Date().toISOString().slice(0, 10);

/** status for a new task: the given one of the project, else the first «todo», else the first by rank */
export async function statusFor(d: ExtDeps, projectId: string, statusId?: string) {
  const rows = await d.db
    .select()
    .from(s.statuses)
    .where(eq(s.statuses.projectId, projectId))
    .orderBy(asc(s.statuses.rank));
  const r = statusId
    ? rows.find((x) => x.id === statusId)
    : (rows.find((x) => x.category === 'todo') ?? rows[0]);
  if (!r) throw new HttpError(404, 'not_found', 'Статус не найден');
  return r.id;
}

export function taskRank(d: ExtDeps, projectId: string, statusId: string) {
  const c = cols('tasks');
  return lastRank(d, 'tasks', and(eq(c.projectId!, projectId), eq(c.statusId!, statusId))!);
}
