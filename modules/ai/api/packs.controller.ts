import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { CORE, HttpError, parseBody, type CoreServices } from '@planar/server-kit';
import { resolveConnection, secretOf } from './connections.js';
import { generateStructured } from './llm.js';
import {
  activate,
  conflictsOf,
  exportPack,
  listCatalog,
  listProjectPacks,
  PackError,
  readCatalogPack,
  unzipFiles,
  upload,
  type PackFiles,
} from './packs.js';

const key = z.string().regex(/^[a-z][a-z0-9_-]{0,49}$/);
const target = z.object({ projectId: z.uuid(), packKey: key });
const source = target.extend({
  /** base64 of a zip; without it the pack comes from the catalog */
  zip: z.string().max(1_400_000).optional(),
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
const mergeBody = source.extend({ key: z.string().min(1).max(60) });

@Controller('api/ai/packs')
export class PacksController {
  constructor(@Inject(CORE) private core: CoreServices) {}

  /** Admin of the project (session only), the module is on. No project and no right look alike for the outside — 404 / 403 as in connections. */
  private async admin(req: object, projectId: string) {
    const a = this.core.auth(req);
    if (a.tokenId) throw new HttpError(403, 'forbidden', 'Только из сессии');
    const r = await this.core.db.execute(
      sql`select (project_role(${a.userId}::uuid, p.id) = 'admin' and 'ai' = any(p.modules)) as ok
          from projects p where p.id = ${projectId}::uuid`,
    );
    if (!r.rows[0]) throw new HttpError(404, 'not_found', 'Не найдено');
    if (!r.rows[0].ok) throw new HttpError(403, 'forbidden', 'Нужна роль администратора');
    return a.userId;
  }

  private async files(b: z.infer<typeof source>): Promise<PackFiles> {
    if (b.zip === undefined) {
      const f = await readCatalogPack(b.packKey);
      if (!f) throw new HttpError(404, 'not_found', 'Такого пакета нет в каталоге');
      return f;
    }
    try {
      return unzipFiles(Buffer.from(b.zip, 'base64'));
    } catch (e) {
      throw new HttpError(400, 'invalid_request', (e as Error).message);
    }
  }

  private fail(e: unknown): never {
    if (e instanceof PackError)
      throw new HttpError(
        e.status,
        e.status === 404 ? 'not_found' : e.status === 409 ? 'conflict' : 'invalid_request',
        e.message,
      );
    throw e;
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
    const files = await this.files(b);
    try {
      return await upload(this.core.db, this.core, userId, { ...b, files });
    } catch (e) {
      this.fail(e);
    }
  }

  /** AI merge of a conflicting page: shows current, incoming and the merged text; nothing is written. */
  @Post('merge')
  @HttpCode(200)
  async merge(@Req() req: object, @Body() body: unknown) {
    const b = parseBody(mergeBody, body);
    await this.admin(req, b.projectId);
    const files = await this.files(b);
    let c;
    try {
      c = await conflictsOf(this.core.db, { ...b, files });
    } catch (e) {
      this.fail(e);
    }
    const inc = c.incoming.find((p) => p.key === b.key);
    const cur = c.current.get(b.key);
    if (!inc || !cur || !c.conflicts.some((x) => x.key === b.key))
      throw new HttpError(409, 'conflict', 'У этой страницы нет расхождений с пакетом');
    const conn = await resolveConnection(this.core.db, b.projectId);
    if (!conn) throw new HttpError(409, 'conflict', 'Не настроено подключение к ИИ');
    let merged: string;
    try {
      ({
        object: { merged },
      } = await generateStructured(secretOf(conn), {
        schema: z.object({ merged: z.string() }),
        system:
          'Ты объединяешь две версии одного документа: текущую (её правил человек) и новую из пакета. Сохрани правки человека и добавь изменения нового пакета. Сохрани формат текста, включая блок --- в начале. Ответ — JSON {"merged": "<полный текст>"}.',
        prompt: `# Текущая версия\n\n${cur.file}\n\n# Новая версия из пакета\n\n${inc.file}`,
        maxOutputTokens: 8000,
      }));
    } catch {
      throw new HttpError(502, 'unavailable', 'Провайдер недоступен');
    }
    return { key: b.key, current: cur.file, incoming: inc.file, merged };
  }

  @Post('activate')
  @HttpCode(200)
  async activate(@Req() req: object, @Body() body: unknown) {
    const b = parseBody(target, body);
    await this.admin(req, b.projectId);
    try {
      return await activate(this.core.db, this.core, b.projectId, b.packKey);
    } catch (e) {
      this.fail(e);
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
      this.fail(e);
    }
    void reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${b.packKey}.zip"`)
      .send(zip);
  }
}
