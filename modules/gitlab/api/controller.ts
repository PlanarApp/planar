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
  Put,
  Req,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  CORE,
  decrypt,
  encrypt,
  HttpError,
  parseBody,
  secretKey,
  type CoreServices,
  type JobApi,
} from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import {
  branchTemplateError,
  DEFAULT_BRANCH_TEMPLATE,
  gitRefError,
  renderBranch,
  WORKSPACE_SCOPE_ID,
  type GitlabScope,
} from '../shared/index.js';
import {
  createBranch,
  createMr,
  Deferred,
  fetchProject,
  HttpFail,
  pollConnections,
  Unauthorized,
} from './poll.js';
import {
  gitlabBranches as B,
  gitlabChoices as C,
  gitlabConnections as P,
  gitlabServers as G,
  gitlabMrs as M,
  gitlabProjectSettings as S,
} from './schema.js';
import {
  availableServers,
  bindingsOf,
  choiceOf,
  resolveServer,
  viewOf,
  type Binding,
} from './servers.js';

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
const scope = z.enum(['workspace', 'space', 'project']);
const name = z.string().trim().min(1).max(100);
const serverBody = z.object({ scope, scopeId: z.uuid(), name, baseUrl, token });
const serverPatch = z.object({
  name: name.optional(),
  baseUrl: baseUrl.optional(),
  token: token.optional(),
});
const choiceBody = z.object({ serverId: z.uuid().nullable() });
const postBody = z.object({
  project: z.string().min(1).max(500),
  // absent — the project's effective connection
  serverId: z.uuid().optional(),
});
const branchBody = z.object({ connectionId: z.uuid().optional(), name: z.string().optional() });
const mrBody = z.object({ branchId: z.uuid() });
const templateBody = z.object({ template: z.string().max(200).nullable() });
const invalid = (m: string) => new HttpError(400, 'invalid_request', m);

const iso = (v: string | null) => (v ? new Date(v).toISOString() : null);
const view = (r: Binding) => ({
  id: r.id,
  projectId: r.projectId,
  serverId: r.serverId,
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

  /** C-schema v16: 404 module_disabled if the module is off in the project (no such project — the route answers itself). */
  private async moduleOn(projectId: string) {
    const r = await this.core.db.execute(
      sql`select ('gitlab' = any(modules)) as on from projects where id = ${projectId}::uuid`,
    );
    if (r.rows[0] && !r.rows[0].on)
      throw new HttpError(404, 'module_disabled', 'Модуль gitlab выключен в проекте');
  }

  private tokenOf(sv: { tokenEnc: string }) {
    const key = secretKey();
    if (!key) throw new HttpError(503, 'unavailable', 'PLANAR_SECRET_KEY не задан');
    try {
      return decrypt(sv.tokenEnc, key);
    } catch {
      throw new HttpError(503, 'unavailable', 'Токен GitLab не расшифровывается');
    }
  }

  private async server(id: string) {
    const [r] = await this.core.db
      .select()
      .from(G)
      .where(eq(G.id, uuidOr404(id)));
    if (!r) throw new HttpError(404, 'not_found', 'Не найдено');
    return r;
  }

  /** The level exists: the workspace (nil uuid), a space or a project. */
  private async level(sc: GitlabScope, id: string) {
    if (sc === 'workspace') {
      if (id !== WORKSPACE_SCOPE_ID) throw new HttpError(404, 'not_found', 'Не найдено');
      return;
    }
    const r = await this.core.db.execute(
      sql`select 1 from ${sql.raw(sc === 'space' ? 'spaces' : 'projects')} where id = ${uuidOr404(id)}::uuid`,
    );
    if (!r.rows.length) throw new HttpError(404, 'not_found', 'Не найдено');
  }

  /** Connections available to a level, its own choice and the effective connection. */
  @Get('levels/:scope/:scopeId')
  async levelView(@Req() req: object, @Param('scope') sc: string, @Param('scopeId') id: string) {
    this.admin(req);
    const s = parseBody(scope, sc) as GitlabScope;
    await this.level(s, id);
    const db = this.core.db;
    return {
      servers: (await availableServers(db, s, id)).map(viewOf),
      choice: await choiceOf(db, s, id),
      effective: (await resolveServer(db, s, id))?.id ?? null,
    };
  }

  /** null — inherit; otherwise a connection of the level itself or of a level above. */
  @Put('levels/:scope/:scopeId/choice')
  async setChoice(
    @Req() req: object,
    @Param('scope') sc: string,
    @Param('scopeId') id: string,
    @Body() body: unknown,
  ) {
    this.admin(req);
    const s = parseBody(scope, sc) as GitlabScope;
    const b = parseBody(choiceBody, body);
    await this.level(s, id);
    if (b.serverId === null)
      await this.core.db.delete(C).where(and(eq(C.scope, s), eq(C.scopeId, id)));
    else {
      if (!(await availableServers(this.core.db, s, id)).some((x) => x.id === b.serverId))
        throw invalid('Подключение недоступно этому уровню');
      await this.core.db
        .insert(C)
        .values({ scope: s, scopeId: id, serverId: b.serverId })
        .onConflictDoUpdate({ target: [C.scope, C.scopeId], set: { serverId: b.serverId } });
    }
    return { choice: b.serverId };
  }

  @Post('servers')
  async addServer(@Req() req: object, @Body() body: unknown) {
    this.admin(req);
    const b = parseBody(serverBody, body);
    await this.level(b.scope, b.scopeId);
    const [r] = await this.core.db
      .insert(G)
      .values({
        id: uuidv7(),
        scope: b.scope,
        scopeId: b.scopeId,
        name: b.name,
        baseUrl: b.baseUrl.replace(/\/+$/, ''),
        tokenEnc: encToken(b.token),
      })
      .returning();
    // the own connection of a space / project is what that level uses from now on
    if (b.scope !== 'workspace')
      await this.core.db
        .insert(C)
        .values({ scope: b.scope, scopeId: b.scopeId, serverId: r!.id })
        .onConflictDoUpdate({ target: [C.scope, C.scopeId], set: { serverId: r!.id } });
    return { server: viewOf(r!) };
  }

  @Patch('servers/:id')
  async patchServer(@Req() req: object, @Param('id') id: string, @Body() body: unknown) {
    this.admin(req);
    const b = parseBody(serverPatch, body);
    const sv = await this.server(id);
    const url = b.baseUrl?.replace(/\/+$/, '');
    if (url && url !== sv.baseUrl && (await this.bound(sv.id)))
      throw new HttpError(
        409,
        'conflict',
        'Адрес нельзя менять: к подключению привязаны репозитории',
      );
    const [r] = await this.core.db
      .update(G)
      .set({
        ...(b.name && { name: b.name }),
        ...(url && { baseUrl: url }),
        ...(b.token && { tokenEnc: encToken(b.token) }),
      })
      .where(eq(G.id, sv.id))
      .returning();
    // a new token lifts the stop after a 401
    if (b.token)
      await this.core.db
        .update(P)
        .set({ lastError: null, lastErrorAt: null })
        .where(eq(P.serverId, sv.id));
    return { server: viewOf(r!) };
  }

  private async bound(serverId: string) {
    const r = await this.core.db
      .select({ id: P.id })
      .from(P)
      .where(eq(P.serverId, serverId))
      .limit(1);
    return r.length > 0;
  }

  /** Not while repositories are bound through it (409); levels that chose it fall back to inheriting. */
  @Delete('servers/:id')
  @HttpCode(204)
  async removeServer(@Req() req: object, @Param('id') id: string) {
    this.admin(req);
    const sv = await this.server(id);
    if (await this.bound(sv.id))
      throw new HttpError(
        409,
        'conflict',
        'К подключению привязаны репозитории проектов — сначала отвяжите их',
      );
    await this.core.db.delete(C).where(eq(C.serverId, sv.id));
    await this.core.db.delete(G).where(eq(G.id, sv.id));
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
    await this.moduleOn(uuidOr404(projectId));
    const rs = await bindingsOf(this.core.db, eq(P.projectId, uuidOr404(projectId)));
    return { connections: rs.map(view) };
  }

  @Post('projects/:projectId/connections')
  async add(@Req() req: object, @Param('projectId') projectId: string, @Body() body: unknown) {
    this.admin(req);
    const b = parseBody(postBody, body);
    await this.moduleOn(uuidOr404(projectId));
    const p = await this.core.db.execute(
      sql`select 1 from projects where id = ${uuidOr404(projectId)}`,
    );
    if (!p.rows.length) throw new HttpError(404, 'not_found', 'Проект не найден');
    const sv = b.serverId
      ? (await availableServers(this.core.db, 'project', projectId)).find(
          (x) => x.id === b.serverId,
        )
      : await resolveServer(this.core.db, 'project', projectId);
    if (!sv)
      throw b.serverId
        ? new HttpError(404, 'not_found', 'Подключение недоступно проекту')
        : new HttpError(409, 'conflict', 'Подключение GitLab не настроено');
    const url = sv.baseUrl;
    const token = this.tokenOf(sv);
    let found;
    try {
      found = await fetchProject(url, token, b.project);
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
    const [had] = await bindingsOf(this.core.db, same);
    if (had && had.baseUrl !== url)
      throw new HttpError(409, 'conflict', 'Репозиторий с таким id уже подключён с другого адреса');
    // the same repository again — refresh the path and the connection
    await this.core.db
      .insert(P)
      .values({
        id: uuidv7(),
        projectId,
        serverId: sv.id,
        gitlabProjectId: found.id,
        path: found.path,
      })
      .onConflictDoUpdate({
        target: [P.projectId, P.gitlabProjectId],
        set: { path: found.path, serverId: sv.id, lastError: null, lastErrorAt: null },
      });
    const [r] = await bindingsOf(this.core.db, same);
    return { connection: view(r!) };
  }

  @Delete('connections/:id')
  @HttpCode(204)
  async remove(@Req() req: object, @Param('id') id: string) {
    this.admin(req);
    const c = await this.conn(id);
    await this.moduleOn(c.projectId);
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
    // PLNRAPP-153: and the branches of this repository on the project's tasks
    const drop = {
      name: 'gitlab.branch.dropRepo',
      args: { projectId: c.projectId, gitlabProjectId: c.gitlabProjectId },
    };
    await this.core.execute(this.core.systemUserId(), [...muts, drop], { system: true });
    await this.core.db.delete(P).where(eq(P.id, c.id));
  }

  @Post('poll')
  @HttpCode(202)
  async poll(@Req() req: object) {
    this.admin(req);
    await this.core.enqueue('gitlab.poll', {}, { singletonKey: 'gitlab.poll' });
    return {};
  }

  /**
   * PLNRAPP-153: the project's branch name template (null — {TASK_KEY}). Not a guest of the project and not
   * a read-only token; the template is checked (placeholders, braces, git ref on sample data) — 400 with the reason.
   */
  @Put('projects/:projectId/branch-template')
  async setTemplate(
    @Req() req: object,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
  ) {
    const b = parseBody(templateBody, body);
    const a = this.core.auth(req);
    const r = await this.core.db.execute(
      sql`select project_role(${a.userId}::uuid, id) as role from projects where id = ${uuidOr404(projectId)}::uuid`,
    );
    const role = r.rows[0]?.role as string | null | undefined;
    if (!role) throw new HttpError(404, 'not_found', 'Проект не найден');
    if (role === 'guest' || a.tokenScope === 'read')
      throw new HttpError(403, 'forbidden', 'Шаблон ветки меняет участник проекта, не гость');
    await this.moduleOn(projectId);
    const template = b.template?.trim() || null;
    const err = template === null ? null : branchTemplateError(template);
    if (err) throw invalid(err);
    await this.core.execute(
      this.core.systemUserId(),
      [{ name: 'gitlab.setBranchTemplate', args: { projectId, template } }],
      { system: true },
    );
    return { template };
  }

  /**
   * PLNRAPP-153, the task's GitLab tab: the task and its project's connections. Anyone with access to
   * the project reads and polls; a branch and an MR — not a guest and not a read-only token.
   */
  private async ofTask(req: object, taskId: string, write = false) {
    const a = this.core.auth(req);
    const r = await this.core.db.execute(
      sql`select t.project_id as "projectId", t.title, p.key || '-' || t.number as key,
            project_role(${a.userId}::uuid, t.project_id) as role
          from tasks t join projects p on p.id = t.project_id where t.id = ${uuidOr404(taskId)}::uuid`,
    );
    const t = r.rows[0] as
      { projectId: string; title: string; key: string | null; role: string | null } | undefined;
    if (!t?.role) throw new HttpError(404, 'not_found', 'Задача не найдена');
    if (write && (t.role === 'guest' || a.tokenScope === 'read'))
      throw new HttpError(403, 'forbidden', 'Нет прав на изменение задачи');
    await this.moduleOn(t.projectId);
    const conns = await bindingsOf(this.core.db, eq(P.projectId, t.projectId));
    return { t, conns, userId: a.userId };
  }

  private jobApi(): JobApi {
    const c = this.core;
    return {
      db: c.db,
      execute: (...a) => c.execute(...a),
      enqueue: (...a) => c.enqueue(...a),
      systemUserId: c.systemUserId(),
    };
  }

  @Get('tasks/:taskId/repos')
  async repos(@Req() req: object, @Param('taskId') taskId: string) {
    const { conns } = await this.ofTask(req, taskId);
    return { repos: conns.map((c) => ({ id: c.id, path: c.path })) };
  }

  /** The branch name by the project's template for this task and the current user (preview in the dialog). */
  @Get('tasks/:taskId/branch-name')
  async branchName(@Req() req: object, @Param('taskId') taskId: string) {
    const { t, userId } = await this.ofTask(req, taskId);
    const r = await this.nameFor(t, userId);
    return { ...r, error: gitRefError(r.name) };
  }

  private async nameFor(
    t: { projectId: string; title: string; key: string | null },
    userId: string,
  ) {
    if (!t.key) throw new HttpError(409, 'conflict', 'У задачи ещё нет номера');
    const [st] = await this.core.db.select().from(S).where(eq(S.id, t.projectId));
    const u = await this.core.db.execute(sql`select login from users where id = ${userId}::uuid`);
    const template = st?.branchTemplate ?? DEFAULT_BRANCH_TEMPLATE;
    const name = renderBranch(template, {
      key: t.key,
      title: t.title,
      login: (u.rows[0]?.login as string | undefined) ?? '',
    });
    return { name, template };
  }

  @Post('tasks/:taskId/poll')
  @HttpCode(200)
  async pollTask(@Req() req: object, @Param('taskId') taskId: string) {
    const { conns } = await this.ofTask(req, taskId);
    await pollConnections(this.jobApi(), conns);
    return {};
  }

  /** A branch from the default branch (name — given or by the template), linked to the task. */
  @Post('tasks/:taskId/branch')
  async branch(@Req() req: object, @Param('taskId') taskId: string, @Body() body: unknown) {
    const b = parseBody(branchBody, body ?? {});
    const { t, conns, userId } = await this.ofTask(req, taskId, true);
    const name = b.name?.trim() || (await this.nameFor(t, userId)).name;
    const err = gitRefError(name);
    if (err) throw invalid(err);
    const c = b.connectionId ? conns.find((x) => x.id === b.connectionId) : conns[0];
    if (!c) throw new HttpError(404, 'not_found', 'Репозиторий не подключён к проекту');
    const { webUrl } = await this.gitlab(c, (token) => createBranch(token, c, name));
    await this.core.execute(
      this.core.systemUserId(),
      [
        {
          name: 'gitlab.branch.link',
          args: { id: uuidv7(), taskId, gitlabProjectId: c.gitlabProjectId, name, webUrl },
        },
      ],
      { system: true },
    );
    const [row] = await this.core.db
      .select()
      .from(B)
      .where(and(eq(B.taskId, taskId), eq(B.gitlabProjectId, c.gitlabProjectId), eq(B.name, name)));
    return { branch: { id: row!.id, name, webUrl: row!.webUrl } };
  }

  /** An MR from the task's branch into the default branch with the title «<key>: <task title>». */
  @Post('tasks/:taskId/mr')
  async mr(@Req() req: object, @Param('taskId') taskId: string, @Body() body: unknown) {
    const b = parseBody(mrBody, body ?? {});
    const { t, conns } = await this.ofTask(req, taskId, true);
    const [br] = await this.core.db
      .select()
      .from(B)
      .where(and(eq(B.id, b.branchId), eq(B.taskId, taskId)));
    if (!br) throw new HttpError(404, 'not_found', 'Ветка не привязана к задаче');
    const c = conns.find((x) => x.gitlabProjectId === br.gitlabProjectId);
    if (!c) throw new HttpError(404, 'not_found', 'Репозиторий не подключён к проекту');
    if (!t.key) throw new HttpError(409, 'conflict', 'У задачи ещё нет номера');
    return this.gitlab(c, (token) =>
      createMr(this.jobApi(), token, c, br.name, `${t.key}: ${t.title}`),
    );
  }

  /** A call to GitLab with the connection's token; its errors → HTTP. */
  private async gitlab<T>(c: Binding, f: (token: string) => Promise<T>): Promise<T> {
    const key = secretKey();
    if (!key) throw new HttpError(503, 'unavailable', 'PLANAR_SECRET_KEY не задан');
    let token: string;
    try {
      token = decrypt(c.tokenEnc, key);
    } catch {
      throw new HttpError(503, 'unavailable', 'Токен GitLab не расшифровывается');
    }
    try {
      return await f(token);
    } catch (e) {
      if (e instanceof HttpFail && e.status === 409)
        throw new HttpError(409, 'conflict', 'MR из этой ветки уже есть');
      if (e instanceof Unauthorized)
        throw new HttpError(502, 'unavailable', 'GitLab отклонил токен или не хватает прав');
      throw new HttpError(
        502,
        'unavailable',
        e instanceof Deferred ? 'GitLab ограничил запросы' : 'GitLab недоступен',
      );
    }
  }
}
