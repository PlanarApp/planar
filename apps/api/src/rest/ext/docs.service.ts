import { inArray } from 'drizzle-orm';
import { textToDoc } from '@planar/shared';
import * as s from '../../db/schema.js';
import { notFound, rawRow, visibleSpaceOf } from './planning.service.js';
import type { ExtDeps } from './types.js';

/** a page (live or archived) of a space the user is in; a project page — project access and docs on there; else 404 */
export async function pageOf(d: ExtDeps, userId: string, id: string) {
  const r = await rawRow(d, 'docsPages', id);
  if (!r) throw notFound('Страница');
  await visibleSpaceOf(d, userId, r.spaceId as string, 'Страница');
  if (r.projectId) {
    await d.visibleProject(userId, r.projectId as string).catch(() => {
      throw notFound('Страница');
    });
    await d.moduleOn(userId, 'docs', r.projectId as string);
  }
  return r;
}

/** a comment of a visible page */
export async function commentOf(d: ExtDeps, userId: string, id: string) {
  const c = await rawRow(d, 'docsComments', id);
  if (!c) throw notFound('Комментарий');
  await pageOf(d, userId, c.pageId as string);
  return c;
}

/** comment text with @login → ProseMirror doc (as add_doc_comment) */
export async function commentDoc(d: ExtDeps, text: string) {
  const logins = [...text.matchAll(/@([\w.-]+)/g)].map((m) => m[1]!);
  const users = logins.length
    ? await d.db
        .select({ id: s.users.id, login: s.users.login })
        .from(s.users)
        .where(inArray(s.users.login, logins))
    : [];
  return textToDoc(text, users);
}
