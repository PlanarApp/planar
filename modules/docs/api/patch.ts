import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { JSONContent } from '@tiptap/core';
import { docToMarkdown, markdownToDoc } from '@planar/editor/markdown';
import type { HttpErrorCode } from '@planar/shared';
import { HttpError, type JobApi } from '@planar/server-kit';

/** docai-patch v1: 1..50 edits, find non-empty ≤ 16 KB */
export const pagePatchSchema = z.object({
  edits: z
    .array(
      z.object({
        find: z.string().min(1).max(16384).describe('фрагмент markdown страницы'),
        replace: z.string(),
        all: z.boolean().optional().describe('заменить все вхождения (иначе — ровно одно)'),
      }),
    )
    .min(1)
    .max(50),
});
export type PagePatch = z.infer<typeof pagePatchSchema>;

type Q = { execute(q: SQL): Promise<{ rows: unknown[] }> };
/** the part of CoreServices / JobApi / REST that the patch needs */
export interface PatchDeps {
  db: Q;
  execute(userId: string, muts: { name: string; args: unknown }[]): ReturnType<JobApi['execute']>;
}

const STATUS: Record<string, [number, HttpErrorCode]> = {
  invalid_args: [400, 'invalid_request'],
  forbidden: [403, 'forbidden'],
  not_found: [404, 'not_found'],
  conflict: [409, 'conflict'],
};
// shortcut: patch_* are outside HttpErrorCode (packages/shared) — cast; add them to the enum when the contract is widened
const fail = (code: string, message: string) =>
  new HttpError(400, code as HttpErrorCode, message);

const hasMention = (n: JSONContent): boolean =>
  n.type === 'mention' || !!n.content?.some(hasMention);

/** find → replace over the page markdown, written by docs.page.update on behalf of actor (all or nothing) */
export async function applyPagePatch(
  deps: PatchDeps,
  a: { pageId: string; edits: PagePatch['edits'] },
  actor: string,
): Promise<{ ok: true; versionId?: string }> {
  if (!a.edits.length || a.edits.some((e) => !e.find)) throw fail('patch_empty', 'Пустая правка');
  const [row] = z.uuid().safeParse(a.pageId).success
    ? ((await deps.db.execute(
        sql`select body from docs_pages where id = ${a.pageId} and archived_at is null`,
      )).rows as { body: JSONContent }[])
    : [];
  if (!row) throw new HttpError(404, 'not_found', 'Документ не найден');
  // the markdown round trip would flatten mention nodes — refuse the page whole
  if (hasMention(row.body)) throw fail('patch_mentions', 'В странице есть упоминания — патч невозможен');
  let md = docToMarkdown(row.body);
  for (const e of a.edits) {
    const parts = md.split(e.find);
    if (parts.length < 2) throw fail('patch_not_found', `Фрагмент не найден: ${e.find.slice(0, 80)}`);
    if (parts.length > 2 && !e.all)
      throw fail('patch_ambiguous', `Фрагмент найден ${parts.length - 1} раз: ${e.find.slice(0, 80)}`);
    md = parts.join(e.replace);
  }
  const body = markdownToDoc(md);
  try {
    await deps.execute(actor, [{ name: 'docs.page.update', args: { id: a.pageId, body } }]);
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    const m = typeof code === 'string' ? STATUS[code] : undefined;
    if (!m || e instanceof HttpError) throw e;
    throw new HttpError(m[0], m[1], (e as Error).message);
  }
  const v = (await deps.db.execute(
    sql`select id from docs_versions where page_id = ${a.pageId} order by created_at desc limit 1`,
  )).rows[0] as { id: string } | undefined;
  return { ok: true, ...(v && { versionId: v.id }) };
}
