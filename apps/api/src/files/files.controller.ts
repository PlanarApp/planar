import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { Controller, Get, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { and, eq, exists, or } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { getAuth } from '../auth/auth.js';
import { HttpError } from '../auth/errors.js';
import type { Db } from '../db/index.js';
import { attachments, fileUploads, files, spaceMembers, users } from '../db/schema.js';
import { enabledModules } from '../modules/enabled.js';
import { installed } from '../modules/installed.js';
import { DB } from '../tokens.js';

export const FILES_OPTS = Symbol('FILES_OPTS');
export type FilesOpts = { dataDir: string; maxUploadMb: number };

const SHA = /^[0-9a-f]{64}$/;
const notFound = () => new HttpError(404, 'not_found', 'Файл не найден');
const badRequest = (m: string) => new HttpError(400, 'invalid_request', m);

@Controller('files')
export class FilesController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(FILES_OPTS) private readonly opts: FilesOpts,
  ) {}

  private path(sha: string) {
    return join(this.opts.dataDir, 'files', sha.slice(0, 2), sha.slice(2, 4), sha);
  }

  @Post()
  async upload(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const { userId } = getAuth(req);
    if (!req.isMultipart()) throw badRequest('Ожидается multipart/form-data');
    const tmpDir = join(this.opts.dataDir, 'tmp');
    await mkdir(tmpDir, { recursive: true });
    const tmp = join(tmpDir, randomUUID());
    const hash = createHash('sha256');
    let size = 0;
    let mime = '';
    let got = false;
    try {
      for await (const part of req.parts({
        limits: { fileSize: this.opts.maxUploadMb * 1024 * 1024 },
      })) {
        if (part.type !== 'file' || part.fieldname !== 'file' || got) {
          if (part.type === 'file') part.file.resume();
          throw badRequest('Нужно ровно одно поле file');
        }
        got = true;
        mime = part.mimetype;
        await pipeline(
          part.file,
          new Transform({
            transform(chunk: Buffer, _e, cb) {
              hash.update(chunk);
              size += chunk.length;
              cb(null, chunk);
            },
          }),
          createWriteStream(tmp),
        );
        if (part.file.truncated)
          throw new HttpError(413, 'payload_too_large', 'Файл слишком большой');
      }
      if (!got) throw badRequest('Нужно ровно одно поле file');
    } catch (e) {
      await rm(tmp, { force: true });
      if (e instanceof HttpError) throw e;
      // fastify-multipart бросает FST_* с statusCode (лимиты частей и т.п.)
      const code = (e as { statusCode?: number }).statusCode;
      throw code === 413
        ? new HttpError(413, 'payload_too_large', 'Файл слишком большой')
        : code && code < 500
          ? badRequest('Некорректный multipart')
          : e;
    }
    const sha = hash.digest('hex');
    const dest = this.path(sha);
    try {
      let width: number | null = null;
      let height: number | null = null;
      if (mime.startsWith('image/')) {
        try {
          const m = await sharp(tmp).metadata();
          width = m.width ?? null;
          height = m.height ?? null;
        } catch {
          // не картинка или битая — размеров нет
        }
      }
      if (
        await stat(dest).then(
          () => true,
          () => false,
        )
      )
        await rm(tmp);
      else {
        await mkdir(join(dest, '..'), { recursive: true });
        await rename(tmp, dest);
      }
      await this.db
        .insert(files)
        .values({ sha256: sha, size, mime, width, height, createdBy: userId })
        .onConflictDoNothing();
      await this.db.insert(fileUploads).values({ sha256: sha, userId }).onConflictDoNothing();
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    const [row] = await this.db.select().from(files).where(eq(files.sha256, sha));
    void reply.status(201).send({
      sha256: sha,
      size: row!.size,
      mime: row!.mime,
      width: row!.width,
      height: row!.height,
    });
  }

  /** Строка files, если файл существует и пользователь вправе его видеть; иначе 404. */
  private async accessible(sha: string, userId: string) {
    if (!SHA.test(sha)) throw notFound();
    const [row] = await this.db.select().from(files).where(eq(files.sha256, sha));
    if (!row) throw notFound();
    if (await this.builtinAccess(sha, userId)) return row;
    // модули (collab X-core п. 4): true любого включённого — отдать
    const on = await enabledModules(this.db);
    for (const m of installed)
      if (on.has(m.api.id) && (await m.api.canReadFile?.(this.db, userId, sha))) return row;
    throw notFound();
  }

  private async builtinAccess(sha: string, userId: string): Promise<boolean> {
    const [ok] = await this.db
      .select({ x: files.sha256 })
      .from(files)
      .where(
        and(
          eq(files.sha256, sha),
          or(
            exists(
              this.db
                .select({ x: attachments.id })
                .from(attachments)
                .innerJoin(spaceMembers, eq(spaceMembers.spaceId, attachments.spaceId))
                .where(and(eq(attachments.fileSha256, sha), eq(spaceMembers.userId, userId))),
            ),
            exists(this.db.select({ x: users.id }).from(users).where(eq(users.avatarFile, sha))),
            exists(
              this.db
                .select({ x: fileUploads.sha256 })
                .from(fileUploads)
                .where(and(eq(fileUploads.sha256, sha), eq(fileUploads.userId, userId))),
            ),
          ),
        ),
      );
    return !!ok;
  }

  @Get(':sha256')
  async download(
    @Param('sha256') sha: string,
    @Query('name') name: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const row = await this.accessible(sha, getAuth(req).userId);
    reply
      .header('ETag', `"${sha}"`)
      .header('Cache-Control', 'private, max-age=31536000, immutable');
    if (req.headers['if-none-match']?.split(',').some((t) => t.trim() === `"${sha}"`)) {
      return reply.status(304).send();
    }
    if (name) {
      reply.header(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      );
    }
    return reply
      .header('Content-Type', row.mime)
      .header('Content-Length', row.size)
      .send(createReadStream(this.path(sha)));
  }

  @Get(':sha256/preview')
  async preview(
    @Param('sha256') sha: string,
    @Query('w') w: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const row = await this.accessible(sha, getAuth(req).userId);
    if (!row.mime.startsWith('image/')) throw notFound();
    if (w !== '256' && w !== '1024') throw badRequest('w: 256 или 1024');
    const cache = join(this.opts.dataDir, 'previews', `${sha}_${w}.webp`);
    if (
      !(await stat(cache).then(
        () => true,
        () => false,
      ))
    ) {
      await mkdir(join(cache, '..'), { recursive: true });
      const tmp = `${cache}.${randomUUID()}.tmp`;
      try {
        // нет файла на диске — 404; остальные сбои диска и sharp — 500 (фильтр логирует)
        await stat(this.path(sha)).catch((e: NodeJS.ErrnoException) => {
          throw e.code === 'ENOENT' ? notFound() : e;
        });
        await sharp(this.path(sha))
          .resize({ width: Number(w), withoutEnlargement: true })
          .webp()
          .toFile(tmp);
        await rename(tmp, cache);
      } catch (e) {
        await rm(tmp, { force: true });
        throw e;
      }
    }
    return reply
      .header('Content-Type', 'image/webp')
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(createReadStream(cache));
  }
}
