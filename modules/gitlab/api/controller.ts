import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { CORE, HttpError, parseBody, type CoreServices } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import { decrypt, encrypt, secretKey } from './crypto.js';
import { Deferred, fetchProject, HttpFail, Unauthorized } from './poll.js';
import { gitlabConfig as C, gitlabMrs as M, gitlabProjects as P } from './schema.js';

const baseUrl = z
  .string()
  .max(2000)
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'http:' || u.protocol === 'https:') && !u.username && !u.password;
    } catch {
      return false;
    }
  }, 'нужен http(s)-адрес без логина и пароля');
const putBody = z.object({
  baseUrl: baseUrl.optional(),
  token: z.string().min(1).max(500).nullable().optional(),
  intervalSec: z.number().int().min(60).max(3600).optional(),
});
const postProject = z.object({ project: z.string().min(1).max(500) });

const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
const project = (r: typeof P.$inferSelect) => ({
  id: r.id,
  gitlabProjectId: r.gitlabProjectId,
  path: r.path,
  lastPolledAt: iso(r.lastPolledAt),
  lastError: r.lastError,
  lastErrorAt: iso(r.lastErrorAt),
});

@Controller('api/gitlab')
export class GitlabController {
  constructor(@Inject(CORE) private core: CoreServices) {}

  private admin(req: object) {
    return this.core.requireInstanceAdmin(req, { sessionOnly: true });
  }

  private async view() {
    const [c] = await this.core.db.select().from(C).where(eq(C.id, 'default'));
    const ps = await this.core.db.select().from(P).orderBy(P.createdAt, P.id);
    return {
      baseUrl: c?.baseUrl ?? 'https://gitlab.com',
      hasToken: !!c?.tokenEnc,
      intervalSec: c?.intervalSec ?? 120,
      lastError: c?.lastError ?? null,
      lastErrorAt: iso(c?.lastErrorAt ?? null),
      projects: ps.map(project),
    };
  }

  @Get('config')
  async get(@Req() req: object) {
    this.admin(req);
    return this.view();
  }

  @Put('config')
  async put(@Req() req: object, @Body() body: unknown) {
    this.admin(req);
    const b = parseBody(putBody, body);
    const set: Partial<typeof C.$inferInsert> = { updatedAt: new Date().toISOString() };
    if (b.baseUrl !== undefined) set.baseUrl = b.baseUrl.replace(/\/+$/, '');
    if (b.intervalSec !== undefined) set.intervalSec = b.intervalSec;
    if (b.token !== undefined) {
      if (b.token === null) set.tokenEnc = null;
      else {
        const key = secretKey();
        if (!key) throw new HttpError(503, 'unavailable', 'PLANAR_SECRET_KEY не задан');
        set.tokenEnc = encrypt(b.token, key);
      }
      set.lastError = null; // смена токена снимает остановку после 401
      set.lastErrorAt = null;
    }
    await this.core.db
      .insert(C)
      .values({ id: 'default', baseUrl: 'https://gitlab.com', ...set })
      .onConflictDoUpdate({ target: C.id, set });
    return this.view();
  }

  @Post('projects')
  async addProject(@Req() req: object, @Body() body: unknown) {
    this.admin(req);
    const b = parseBody(postProject, body);
    const [c] = await this.core.db.select().from(C).where(eq(C.id, 'default'));
    const key = secretKey();
    if (!c?.tokenEnc || !key) throw new HttpError(409, 'not_configured', 'Сначала задайте токен');
    let found;
    try {
      found = await fetchProject(c.baseUrl, decrypt(c.tokenEnc, key), b.project);
    } catch (e) {
      if (e instanceof HttpFail && e.status === 404)
        throw new HttpError(404, 'not_found', 'Проект не найден в GitLab');
      if (e instanceof Unauthorized)
        throw new HttpError(502, 'gitlab_unauthorized', 'GitLab отклонил токен');
      throw new HttpError(
        502,
        'gitlab_unreachable',
        e instanceof Deferred ? 'GitLab ограничил запросы' : 'GitLab недоступен',
      );
    }
    await this.core.db
      .insert(P)
      .values({ id: uuidv7(), gitlabProjectId: found.id, path: found.path })
      .onConflictDoUpdate({ target: P.gitlabProjectId, set: { path: found.path } });
    const [r] = await this.core.db.select().from(P).where(eq(P.gitlabProjectId, found.id));
    return { project: project(r!) };
  }

  @Delete('projects/:id')
  @HttpCode(204)
  async removeProject(@Req() req: object, @Param('id') id: string) {
    this.admin(req);
    const [r] = z.uuid().safeParse(id).success
      ? await this.core.db.select().from(P).where(eq(P.id, id))
      : [];
    if (!r) throw new HttpError(404, 'not_found', 'Не найдено');
    // shortcut: прямое удаление без записи в журнал синхронизации — клиенты увидят MR до перезагрузки
    await this.core.db.transaction(async (tx) => {
      await tx.delete(M).where(eq(M.gitlabProjectId, r.gitlabProjectId));
      await tx.delete(P).where(eq(P.id, id));
    });
  }

  @Post('poll')
  @HttpCode(202)
  async poll(@Req() req: object) {
    this.admin(req);
    await this.core.enqueue('gitlab.poll', {}, { singletonKey: 'gitlab.poll' });
    return {};
  }
}
