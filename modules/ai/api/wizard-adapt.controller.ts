import { Body, Controller, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { docToMarkdown, markdownToDoc } from '@planar/editor/markdown';
import { CORE, HttpError, parseBody, type CoreServices } from '@planar/server-kit';
import { lineDiff } from '../shared/index.js';
import { resolveConnection, secretOf } from './connections.js';
import { generateStructured } from './llm.js';
import { PACKS_ROOT_TITLE } from './packs.js';
import { blocked } from './run.js';
import { uuidv7 } from '@planar/shared';

// markdown has no mention node: accepting would turn it into plain «@Name»
const hasMention = (body: unknown) => JSON.stringify(body).includes('"type":"mention"');
const NO_MENTIONS = 'Страница с упоминаниями не поддерживается';

const NOT_PACK = 'Адаптировать можно только страницу harness-пакета';

const adaptBody = z.object({
  pageId: z.uuid(),
  message: z.string().min(1).max(4000),
});
const applyBody = z.object({
  pageId: z.uuid(),
  body: z.string().max(200_000),
  baseUpdatedAt: z.string().min(1).max(64),
});

interface PageRow {
  title: string;
  body: unknown;
  projectId: string | null;
  updatedAt: string;
  /** the page is a pack page: its parent or grandparent is the root «Harness-пакеты» of the same project */
  pack: boolean;
}

const HTTP: Record<string, [number, 'invalid_request' | 'forbidden' | 'not_found' | 'conflict']> = {
  invalid_args: [400, 'invalid_request'],
  forbidden: [403, 'forbidden'],
  not_found: [404, 'not_found'],
  conflict: [409, 'conflict'],
};

/** Step «Adapt with AI» of the setup wizard: a pack page only (the «Talk to the document» chat is gone). */
@Controller('api/ai/wizard/adapt')
export class WizardAdaptController {
  constructor(@Inject(CORE) private core: CoreServices) {}

  /** The page as the docs controller sees it: visible to a space member with project access; else 404. */
  private async page(userId: string, id: string): Promise<PageRow> {
    const r = await this.core.db.execute(sql`
      select p.title, p.body, p.project_id as "projectId", to_json(p.updated_at) as "updatedAt",
        exists (select 1 from docs_pages a where a.project_id = p.project_id and a.parent_id is null
          and a.title = ${PACKS_ROOT_TITLE}
          and (a.id = p.parent_id or a.id = (select b.parent_id from docs_pages b where b.id = p.parent_id))) as pack
      from docs_pages p
      join space_members me on me.space_id = p.space_id and me.user_id = ${userId}::uuid
      where p.id = ${id}::uuid and p.archived_at is null and (p.project_id is null
        or (project_role(${userId}::uuid, p.project_id) is not null
          and exists (select 1 from projects pr where pr.id = p.project_id and 'docs' = any(pr.modules))))`);
    if (!r.rows[0]) throw new HttpError(404, 'not_found', 'Страница не найдена');
    return r.rows[0] as unknown as PageRow;
  }

  /** Statuses and rules of the project: what a pack page talks about. */
  private async packContext(projectId: string) {
    const p = sql`${projectId}::uuid`;
    const [s, r] = await Promise.all([
      this.core.db.execute(sql`select name, category from statuses where project_id = ${p}`),
      this.core.db.execute(
        sql`select name, description from automations_rules where project_id = ${p}`,
      ),
    ]);
    const statuses = (s.rows as { name: string; category: string }[])
      .map((x) => `- ${x.name} (${x.category})`)
      .join('\n');
    const rules = (r.rows as { name: string; description: string | null }[])
      .map((x) => `- ${x.name}${x.description ? `: ${x.description}` : ''}`)
      .join('\n');
    return `\n\n# Статусы проекта\n${statuses || '—'}\n\n# Правила проекта\n${rules || '—'}`;
  }

  /** Proposal of an edit: the reply and, when the text changes, the whole new text with a line diff. Nothing is written. */
  @Post()
  @HttpCode(200)
  async adapt(@Req() req: object, @Body() body: unknown) {
    const b = parseBody(adaptBody, body);
    const { userId } = this.core.auth(req);
    const page = await this.page(userId, b.pageId);
    if (!page.projectId) throw new HttpError(409, 'conflict', 'ИИ работает только в проекте');
    if (!page.pack) throw new HttpError(409, 'conflict', NOT_PACK);
    const projectId = page.projectId;
    const [g] = (
      await this.core.db.execute(
        sql`select project_role(${userId}::uuid, p.id) as role, 'ai' = any(p.modules) as ai
            from projects p where p.id = ${projectId}::uuid`,
      )
    ).rows as { role: string | null; ai: boolean }[];
    if (!g?.ai) throw new HttpError(409, 'conflict', 'Модуль ИИ выключен в проекте');
    if (g.role !== 'admin' && g.role !== 'member')
      throw new HttpError(403, 'forbidden', 'Недостаточно прав');
    const stop = await blocked(this.core.db, projectId);
    if (stop) throw new HttpError(409, 'conflict', stop);
    if (hasMention(page.body)) throw new HttpError(409, 'conflict', NO_MENTIONS);
    const conn = await resolveConnection(this.core.db, page.projectId);
    if (!conn) throw new HttpError(409, 'conflict', 'Не настроено подключение к ИИ');
    const current = docToMarkdown(page.body as never).trim();
    const ctx = await this.packContext(page.projectId);
    let out: { reply: string; body: string | null };
    try {
      let usage;
      ({ object: out, usage } = await generateStructured(secretOf(conn), {
        schema: z.object({ reply: z.string(), body: z.string().nullable() }),
        system:
          'Ты помогаешь править документ. Ответь пользователю в "reply". Если нужна правка — в "body" верни ПОЛНЫЙ новый текст документа в markdown (сохрани всё, что не меняешь, включая блок кода и ---), иначе null.',
        prompt: `# Документ «${page.title}»\n\n${current}${ctx}\n\n# Сообщение\n${b.message}`,
        maxOutputTokens: 8000,
      }));
      // the spend counts towards the daily limits (usedToday)
      const id = uuidv7();
      await this.core.db.execute(
        sql`insert into ai_runs (id, project_id, kind, state, chain_id, chain_depth, input_tokens, output_tokens, cost)
            values (${id}::uuid, ${projectId}::uuid, 'chat', 'done', ${id}::uuid, 0, ${usage.inputTokens}, ${usage.outputTokens}, ${usage.cost})`,
      );
    } catch {
      throw new HttpError(502, 'unavailable', 'Провайдер недоступен');
    }
    const next = out.body?.trim();
    return {
      reply: out.reply,
      proposal:
        next && next !== current
          ? { body: next, baseUpdatedAt: page.updatedAt, diff: lineDiff(current, next) }
          : null,
    };
  }

  /** Writes the accepted text through docs.page.update (rights, versions, sync); 409 when the page changed since the proposal. */
  @Post('apply')
  @HttpCode(200)
  async apply(@Req() req: object, @Body() body: unknown) {
    const b = parseBody(applyBody, body);
    const { userId } = this.core.auth(req);
    const page = await this.page(userId, b.pageId);
    if (!page.pack) throw new HttpError(409, 'conflict', NOT_PACK);
    if (hasMention(page.body)) throw new HttpError(409, 'conflict', NO_MENTIONS);
    if (Number.isNaN(Date.parse(b.baseUpdatedAt)))
      throw new HttpError(400, 'invalid_request', 'baseUpdatedAt: неверная дата');
    try {
      await this.core.execute(
        userId,
        [{ name: 'docs.page.update', args: { id: b.pageId, body: markdownToDoc(b.body) } }],
        {
          // the row lock makes check+write one step: a concurrent edit waits and then fails the check
          prepare: async (q) => {
            const r = await q.execute(
              sql`select updated_at = ${b.baseUpdatedAt}::timestamptz as ok from docs_pages where id = ${b.pageId}::uuid for update`,
            );
            if (!(r.rows[0] as { ok: boolean } | undefined)?.ok)
              throw new HttpError(409, 'conflict', 'Документ изменили после предложения');
          },
        },
      );
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      const m = typeof code === 'string' ? HTTP[code] : undefined;
      if (!m || e instanceof HttpError) throw e;
      throw new HttpError(m[0], m[1], (e as Error).message);
    }
    const [r] = (
      await this.core.db.execute(
        sql`select to_json(updated_at) as "updatedAt" from docs_pages where id = ${b.pageId}::uuid`,
      )
    ).rows as { updatedAt: string }[];
    return { ok: true, updatedAt: r!.updatedAt };
  }
}
