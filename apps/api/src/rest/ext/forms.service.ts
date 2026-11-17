import { randomInt } from 'node:crypto';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import * as s from '../../db/schema.js';
import { cols, notFound, rawRow, visibleSpaceOf, wireRows } from './planning.service.js';
import type { ExtDeps } from './types.js';

export { cols, lastRank, rawRow, visibleSpaceOf, wireRow, wireRows } from './planning.service.js';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
/** public slug of a form: 16 chars [a-z0-9] (SLUG_RE of modules/forms), crypto-random */
export const genSlug = () => Array.from({ length: 16 }, () => ALPHABET[randomInt(36)]).join('');

/** a form of a project the user sees, with the forms module on there; else 404 */
export async function formRow(d: ExtDeps, userId: string, id: string) {
  const r = await rawRow(d, 'formsForms', id);
  if (!r) throw notFound('Форма');
  const pid = r.projectId as string;
  await d.visibleProject(userId, pid).catch(() => {
    throw notFound('Форма');
  });
  await d.moduleOn(userId, 'forms', pid);
  return r;
}

/** status for a new form when none is given: the first (by rank) of the project */
export async function firstStatus(d: ExtDeps, projectId: string) {
  const [r] = await d.db
    .select({ id: s.statuses.id })
    .from(s.statuses)
    .where(eq(s.statuses.projectId, projectId))
    .orderBy(asc(s.statuses.rank))
    .limit(1);
  return r?.id;
}

/** a dashboard of a space where the user is a member; someone else's personal one is 404 */
export async function boardRow(d: ExtDeps, userId: string, id: string) {
  const r = await rawRow(d, 'dashboardsBoards', id);
  if (!r) throw notFound('Дашборд');
  await visibleSpaceOf(d, userId, r.spaceId as string, 'Дашборд');
  if (r.userId && r.userId !== userId) throw notFound('Дашборд');
  return r;
}

export async function widgetRow(d: ExtDeps, userId: string, id: string) {
  const r = await rawRow(d, 'dashboardsWidgets', id);
  if (!r) throw notFound('Виджет');
  await boardRow(d, userId, r.dashboardId as string).catch(() => {
    throw notFound('Виджет');
  });
  return r;
}

export async function widgetsOf(d: ExtDeps, boardId: string) {
  const w = cols('dashboardsWidgets');
  return wireRows(d, 'dashboardsWidgets', eq(w.dashboardId!, boardId), [w.y!, w.x!, w.id!]);
}

/** dashboards of the space visible to the user (shared + own personal) with widgets */
export async function boardsOf(d: ExtDeps, userId: string, spaceId: string) {
  const b = cols('dashboardsBoards');
  const boards = await wireRows(
    d,
    'dashboardsBoards',
    and(eq(b.spaceId!, spaceId), or(isNull(b.userId!), eq(b.userId!, userId)))!,
    [b.rank!, b.id!],
  );
  const ws = cols('dashboardsWidgets');
  const widgets = await wireRows(d, 'dashboardsWidgets', eq(ws.spaceId!, spaceId), [
    ws.y!,
    ws.x!,
    ws.id!,
  ]);
  return boards.map((x) => ({ ...x, widgets: widgets.filter((w) => w.dashboardId === x.id) }));
}
