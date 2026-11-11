import { Controller, Get, Inject, Param, Post, Req } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { uuidv7, type AfterMutationCtx, type MutationWrite } from '@planar/shared';
import { CORE, HttpError, type CoreServices } from '@planar/server-kit';
import { z } from 'zod';

type Q = { execute(q: SQL): Promise<{ rows: unknown[] }> };

/** edits of one author from one source merge into one version while it is younger than this */
const WINDOW = '10 minutes';
const KEEP = 100;

const insert = (q: Q, pageId: string, body: unknown, source: string | null, by: string, at: string) =>
  q.execute(sql`insert into docs_versions (id, page_id, body, source, created_by, created_at, updated_at)
    values (${uuidv7()}, ${pageId}, ${JSON.stringify(body)}::jsonb, ${source}, ${by}, ${at}, ${at})`);

/** PLNRAPP-185: a page body change → a version (afterMutation); page deletion → its versions go too. */
export async function versions(writes: MutationWrite[], ctx: AfterMutationCtx, q: Q) {
  for (const w of writes) {
    if (w.entity !== 'docsPages') continue;
    const id = String((w.after ?? w.before)!.id);
    if (!w.after) {
      await q.execute(sql`delete from docs_versions where page_id = ${id}`);
      continue;
    }
    if (w.before && JSON.stringify(w.before.body) === JSON.stringify(w.after.body)) continue;
    const source = ctx.tokenId ? 'api' : 'editor';
    const r = await q.execute(sql`
      select id, created_by, source, body = ${JSON.stringify(w.after.body)}::jsonb as same,
        created_at > ${ctx.now}::timestamptz - ${WINDOW}::interval as fresh
      from docs_versions where page_id = ${id} order by created_at desc limit 1`);
    const last = r.rows[0] as
      | { id: string; created_by: string; source: string | null; same: boolean; fresh: boolean }
      | undefined;
    if (last?.same) continue;
    // the history starts: keep the body it had before
    if (!last && w.before)
      await insert(q, id, w.before.body, null, String(w.before.updatedBy), String(w.before.updatedAt));
    if (last && last.fresh && last.created_by === ctx.userId && last.source === source)
      await q.execute(sql`update docs_versions set body = ${JSON.stringify(w.after.body)}::jsonb,
        updated_at = ${ctx.now} where id = ${last.id}`);
    else await insert(q, id, w.after.body, source, ctx.userId, ctx.now);
    await q.execute(sql`delete from docs_versions where page_id = ${id} and id not in
      (select id from docs_versions where page_id = ${id} order by created_at desc limit ${KEEP})`);
  }
}

const HTTP: Record<string, [number, 'invalid_request' | 'forbidden' | 'not_found' | 'conflict']> = {
  invalid_args: [400, 'invalid_request'],
  forbidden: [403, 'forbidden'],
  not_found: [404, 'not_found'],
  conflict: [409, 'conflict'],
};
const COLS = sql`v.id, v.page_id as "pageId", v.source, v.created_by as "createdBy",
  to_json(v.created_at) as "createdAt", to_json(v.updated_at) as "updatedAt"`;

@Controller('api/docs')
export class DocsController {
  constructor(@Inject(CORE) private readonly core: CoreServices) {}

  /** the page is visible to the user (as GET /files: space member, project access, docs on in the project) */
  private async page(req: object, id: string) {
    const { userId } = this.core.auth(req);
    const ok =
      z.uuid().safeParse(id).success &&
      (
        await this.core.db.execute(sql`
          select 1 from docs_pages p
          join space_members me on me.space_id = p.space_id and me.user_id = ${userId}
          where p.id = ${id} and (p.project_id is null
            or (project_role(${userId}::uuid, p.project_id) is not null
              and exists (select 1 from projects pr where pr.id = p.project_id and 'docs' = any(pr.modules))))`)
      ).rows.length > 0;
    if (!ok) throw new HttpError(404, 'not_found', 'Страница не найдена');
    return userId;
  }

  private async version(req: object, id: string) {
    const [v] = z.uuid().safeParse(id).success
      ? ((
          await this.core.db.execute(sql`select ${COLS}, v.body from docs_versions v where v.id = ${id}`)
        ).rows as { pageId: string; body: unknown }[])
      : [];
    if (!v) throw new HttpError(404, 'not_found', 'Версия не найдена');
    return { v, userId: await this.page(req, v.pageId) };
  }

  @Get('pages/:id/versions')
  async list(@Req() req: object, @Param('id') id: string) {
    await this.page(req, id);
    const r = await this.core.db.execute(
      sql`select ${COLS} from docs_versions v where v.page_id = ${id} order by v.created_at desc`,
    );
    return { data: r.rows };
  }

  @Get('versions/:id')
  async one(@Req() req: object, @Param('id') id: string) {
    return { data: (await this.version(req, id)).v };
  }

  /** the version body becomes the page body (docs.page.update — the usual write rights); the history gets a 'restore' version */
  @Post('versions/:id/restore')
  async restore(@Req() req: object, @Param('id') id: string) {
    const { v, userId } = await this.version(req, id);
    try {
      await this.core.execute(
        userId,
        [{ name: 'docs.page.update', args: { id: v.pageId, body: v.body } }],
        {
          // in the same transaction before the write: the hook sees an equal last version and adds nothing
          prepare: async (q) =>
            void (await insert(q as Q, v.pageId, v.body, 'restore', userId, new Date().toISOString())),
        },
      );
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      const m = typeof code === 'string' ? HTTP[code] : undefined;
      if (!m || e instanceof HttpError) throw e;
      throw new HttpError(m[0], m[1], (e as Error).message);
    }
    return { data: { ok: true } };
  }
}
