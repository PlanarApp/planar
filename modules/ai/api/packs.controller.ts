import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { CORE, HttpError, parseBody, type CoreServices } from '@planar/server-kit';
import { resolveConnection, secretOf } from './connections.js';
import { generateStructured } from './llm.js';
import { eventsSchema } from '../shared/index.js';
import { blocked } from './run.js';
import {
  activate,
  assertAiAdmin,
  conflictsOf,
  exportPack,
  failPack,
  listCatalog,
  listProjectPacks,
  lostKeys,
  packFiles,
  preview,
  setEvents,
  upload,
} from './packs.js';

const key = z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/);
const target = z.object({ projectId: z.uuid(), packKey: key });
const source = target.extend({
  /** base64 of a zip; without it the pack comes from the catalog */
  // the app's bodyLimit is 1 MiB: a bigger zip never gets here
  zip: z.string().max(1_000_000).optional(),
  title: z.string().min(1).max(200).optional(),
});
const uploadBody = source.extend({
  resolve: z
    .record(
      z.string(),
      z.union([z.enum(['reset', 'keep']), z.object({ merged: z.string().max(200_000) })]),
    )
    .optional(),
});
const mergeBody = source.extend({ keys: z.array(z.string().min(1).max(60)).min(1).max(50) });
const MERGE_SYSTEM =
  'Ты объединяешь две версии одного документа: текущую (её правил человек) и новую из пакета. Сохрани правки человека и добавь изменения нового пакета. Сохрани формат текста, включая блок --- в начале. Ответ — JSON {"merged": "<полный текст>"}.';
// harness.yml: what the catalog brings must survive the merge (statuses, labels, actions are created from it)
const MERGE_YML =
  ' Это harness.yml: все статусы, метки, поля, действия и правила новой версии остаются; правило, которое есть в обеих версиях, берётся из новой с правками человека; то, что человек добавил сам, тоже остаётся.';
const eventsBody = target.extend({ events: eventsSchema });

@Controller('api/ai/packs')
export class PacksController {
  constructor(@Inject(CORE) private core: CoreServices) {}

  /** Admin of the project, the module is on. A token works with write scope (a read token is refused by the guard for non-GET). */
  private async admin(req: object, projectId: string) {
    const a = this.core.auth(req);
    await assertAiAdmin(this.core.db, a.userId, projectId);
    return a.userId;
  }

  /** The catalog and the packs loaded into the project; a pack whose documents are gone is reset on the way. */
  @Get()
  async list(@Req() req: object, @Query() query: unknown) {
    const { projectId } = parseBody(z.object({ projectId: z.uuid() }), query);
    await this.admin(req, projectId);
    return {
      catalog: await listCatalog(),
      ...(await listProjectPacks(this.core.db, this.core, projectId)),
    };
  }

  /**
   * Loads a pack (catalog or zip) into the project documents. A page the user changed that the new pack changes
   * too comes back as `conflict` with the list; `resolve` {pageKey: reset | keep | {merged}} then writes.
   */
  @Post('upload')
  @HttpCode(200)
  async upload(@Req() req: object, @Body() body: unknown) {
    const b = parseBody(uploadBody, body);
    const userId = await this.admin(req, b.projectId);
    const files = await packFiles(b);
    try {
      return await upload(this.core.db, this.core, userId, { ...b, files });
    } catch (e) {
      failPack(e);
    }
  }

  /** PLNRAPP-538: the pages of the pack that differ from the project or are new (current / incoming); nothing is written. */
  @Post('preview')
  @HttpCode(200)
  async preview(@Req() req: object, @Body() body: unknown) {
    const b = parseBody(source, body);
    await this.admin(req, b.projectId);
    const files = await packFiles(b);
    try {
      return await preview(this.core.db, { ...b, files });
    } catch (e) {
      failPack(e);
    }
  }

  /**
   * AI merge of the pages that differ from the pack, all in one request (a model call per page, in parallel);
   * nothing is written. `warnings` — what of the pack's harness.yml the merged one lost.
   */
  @Post('merge')
  @HttpCode(200)
  async merge(@Req() req: object, @Body() body: unknown) {
    const b = parseBody(mergeBody, body);
    await this.admin(req, b.projectId);
    const files = await packFiles(b);
    let c;
    try {
      c = await conflictsOf(this.core.db, { ...b, files });
    } catch (e) {
      failPack(e);
    }
    const pairs = [...new Set(b.keys)].map((k) => {
      const inc = c.incoming.find((p) => p.key === k);
      const cur = c.current.get(k);
      if (!inc || !cur || inc.hash === cur.hash)
        throw new HttpError(409, 'conflict', `У страницы «${k}» нет расхождений с пакетом`);
      return { key: k, inc, cur };
    });
    const stop = await blocked(this.core.db, b.projectId);
    if (stop) throw new HttpError(409, 'conflict', stop);
    const conn = await resolveConnection(this.core.db, b.projectId);
    if (!conn) throw new HttpError(409, 'conflict', 'Не настроено подключение к ИИ');
    let out: { key: string; merged: string }[];
    try {
      out = await Promise.all(
        pairs.map(async ({ key: k, inc, cur }) => {
          const r = await generateStructured(secretOf(conn), {
            schema: z.object({ merged: z.string() }),
            system: MERGE_SYSTEM + (k === 'harness.yml' ? MERGE_YML : ''),
            prompt: `# Текущая версия\n\n${cur.file}\n\n# Новая версия из пакета\n\n${inc.file}`,
            maxOutputTokens: 8000,
          });
          return { key: k, merged: r.object.merged };
        }),
      );
    } catch {
      throw new HttpError(502, 'unavailable', 'Провайдер недоступен');
    }
    const warnings: string[] = [];
    for (const { key: k, merged } of out) {
      if (k !== 'harness.yml') continue;
      try {
        const lost = lostKeys(pairs.find((p) => p.key === k)!.inc.file, merged);
        if (lost.length) warnings.push(`harness.yml: пропало из пакета — ${lost.join(', ')}`);
      } catch (e) {
        warnings.push(`harness.yml: ${(e as Error).message}`);
      }
    }
    return { merged: Object.fromEntries(out.map((x) => [x.key, x.merged])), warnings };
  }

  @Post('activate')
  @HttpCode(200)
  async activate(@Req() req: object, @Body() body: unknown) {
    const b = parseBody(target, body);
    await this.admin(req, b.projectId);
    try {
      return await activate(this.core.db, this.core, b.projectId, b.packKey);
    } catch (e) {
      failPack(e);
    }
  }

  /** Which action runs on each AI event (comment, mention, checklist, chat); an event without one — the built-in prompt. */
  @Post('events')
  @HttpCode(200)
  async events(@Req() req: object, @Body() body: unknown) {
    const b = parseBody(eventsBody, body);
    await this.admin(req, b.projectId);
    try {
      return await setEvents(this.core.db, b.projectId, b.packKey, b.events);
    } catch (e) {
      failPack(e);
    }
  }

  @Get('export')
  async export(@Req() req: object, @Query() query: unknown, @Res() reply: FastifyReply) {
    const b = parseBody(target, query);
    await this.admin(req, b.projectId);
    let zip: Buffer;
    try {
      zip = await exportPack(this.core.db, b.projectId, b.packKey);
    } catch (e) {
      failPack(e);
    }
    void reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${b.packKey}.zip"`)
      .send(zip);
  }
}
