import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CORE, HttpError, parseBody, type CoreServices } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import { encrypt, secretKey } from './crypto.js';
import { Deferred, fetchProject, HttpFail, Unauthorized } from './poll.js';
import { gitlabConnections as P, gitlabMrs as M } from './schema.js';

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
const token = z.string().min(1).max(500);
const postBody = z.object({ baseUrl, token, project: z.string().min(1).max(500) });
const patchBody = z.object({ token });

const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
const view = (r: typeof P.$inferSelect) => ({
  id: r.id,
  projectId: r.projectId,
  baseUrl: r.baseUrl,
  gitlabProjectId: r.gitlabProjectId,
  path: r.path,
  lastPolledAt: iso(r.lastPolledAt),
  lastError: r.lastError,
  lastErrorAt: iso(r.lastErrorAt),
});
const uuidOr404 = (id: string) => {
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, 'not_found', 'Не найдено');
  return id;
};
const encToken = (t: string) => {
  const key = secretKey();
  if (!key) throw new HttpError(503, 'unavailable', 'PLANAR_SECRET_KEY не задан');
  return encrypt(t, key);
};

@Controller('api/gitlab')
export class GitlabController {
  constructor(@Inject(CORE) private core: CoreServices) {}

  private admin(req: object) {
    return this.core.requireInstanceAdmin(req, { sessionOnly: true });
  }

  private async conn(id: string) {
    const [r] = await this.core.db
      .select()
      .from(P)
      .where(eq(P.id, uuidOr404(id)));
    if (!r) throw new HttpError(404, 'not_found', 'Не найдено');
    return r;
  }

  @Get('projects/:projectId/connections')
  async list(@Req() req: object, @Param('projectId') projectId: string) {
    this.admin(req);
    const rs = await this.core.db
      .select()
      .from(P)
      .where(eq(P.projectId, uuidOr404(projectId)))
      .orderBy(P.createdAt, P.id);
    return { connections: rs.map(view) };
  }

  @Post('projects/:projectId/connections')
  async add(@Req() req: object, @Param('projectId') projectId: string, @Body() body: unknown) {
    this.admin(req);
    const b = parseBody(postBody, body);
    const p = await this.core.db.execute(
      sql`select 1 from projects where id = ${uuidOr404(projectId)}`,
    );
    if (!p.rows.length) throw new HttpError(404, 'not_found', 'Проект не найден');
    const url = b.baseUrl.replace(/\/+$/, '');
    const tokenEnc = encToken(b.token);
    let found;
    try {
      found = await fetchProject(url, b.token, b.project);
    } catch (e) {
      if (e instanceof HttpFail && e.status === 404)
        throw new HttpError(404, 'not_found', 'Проект не найден в GitLab');
      if (e instanceof Unauthorized)
        throw new HttpError(502, 'unavailable', 'GitLab отклонил токен');
      throw new HttpError(
        502,
        'unavailable',
        e instanceof Deferred ? 'GitLab ограничил запросы' : 'GitLab недоступен',
      );
    }
    const same = and(eq(P.projectId, projectId), eq(P.gitlabProjectId, found.id));
    const [had] = await this.core.db.select().from(P).where(same);
    if (had && had.baseUrl !== url)
      throw new HttpError(409, 'conflict', 'Репозиторий с таким id уже подключён с другого адреса');
    // the same repository again — refresh the path and token
    await this.core.db
      .insert(P)
      .values({
        id: uuidv7(),
        projectId,
        baseUrl: url,
        tokenEnc,
        gitlabProjectId: found.id,
        path: found.path,
      })
      .onConflictDoUpdate({
        target: [P.projectId, P.gitlabProjectId],
        set: { path: found.path, tokenEnc, lastError: null, lastErrorAt: null },
      });
    const [r] = await this.core.db.select().from(P).where(same);
    return { connection: view(r!) };
  }

  @Patch('connections/:id')
  async setToken(@Req() req: object, @Param('id') id: string, @Body() body: unknown) {
    this.admin(req);
    const b = parseBody(patchBody, body);
    const c = await this.conn(id);
    // changing the token lifts the stop after a 401
    const [r] = await this.core.db
      .update(P)
      .set({ tokenEnc: encToken(b.token), lastError: null, lastErrorAt: null })
      .where(eq(P.id, c.id))
      .returning();
    return { connection: view(r!) };
  }

  @Delete('connections/:id')
  @HttpCode(204)
  async remove(@Req() req: object, @Param('id') id: string) {
    this.admin(req);
    const c = await this.conn(id);
    // gitlabMrs rows go through the mutator into Tx with a write to changes (clients learn at once)
    const rows = await this.core.db
      .select()
      .from(M)
      .where(eq(M.gitlabProjectId, c.gitlabProjectId));
    const muts = [...new Map(rows.map((x) => [x.iid, x])).values()].map((x) => ({
      name: 'gitlab.mr.sync',
      args: {
        projectId: c.projectId,
        gitlabProjectId: x.gitlabProjectId,
        iid: x.iid,
        mr: {
          title: x.title,
          sourceBranch: x.sourceBranch,
          state: x.state,
          authorName: x.authorName,
          webUrl: x.webUrl,
          mrUpdatedAt: new Date(x.mrUpdatedAt).toISOString(),
        },
        links: [],
      },
    }));
    if (muts.length) await this.core.execute(this.core.systemUserId(), muts, { system: true });
    await this.core.db.delete(P).where(eq(P.id, c.id));
  }

  @Post('poll')
  @HttpCode(202)
  async poll(@Req() req: object) {
    this.admin(req);
    await this.core.enqueue('gitlab.poll', {}, { singletonKey: 'gitlab.poll' });
    return {};
  }
}
