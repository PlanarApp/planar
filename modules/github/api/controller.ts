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
  Query,
  Req,
} from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  CORE,
  decrypt,
  encrypt,
  HttpError,
  parseBody,
  secretKey,
  type CoreServices,
  type Db,
  type JobApi,
} from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import {
  GITHUB_ERRORS,
  WORKSPACE_SCOPE_ID,
  type GithubAvailableView,
  type GithubLevelView,
  type GithubRepoView,
  type GithubScope,
} from '../shared/index.js';
import {
  availableConnections,
  choiceOf,
  resolveConnection,
  viewOf,
  type Connection,
} from './connections.js';
import { fetchRepo, ghGet, listRepos } from './repos.js';
import { githubChoices as C, githubConnections as G, githubRepos as R } from './schema.js';
import { syncProject } from './sync.js';

type Repo = typeof R.$inferSelect;

const scope = z.enum(['workspace', 'space', 'project']);
const token = z.string().trim().min(1).max(500);
const connectBody = z.object({ scope, scopeId: z.uuid(), token });
const choiceBody = z.object({ connectionId: z.uuid().nullable() });
// «owner/name» as GitHub allows: letters, digits, «-», «_», «.»
const bindBody = z.object({
  fullName: z
    .string()
    .trim()
    .max(200)
    .regex(/^[\w.-]+\/[\w.-]+$/, 'нужно имя репозитория вида owner/name'),
});
const invalid = (m: string) => new HttpError(400, 'invalid_request', m);
const notFound = () => new HttpError(404, 'not_found', 'Не найдено');
const uuidOr404 = (id: string) => {
  if (!z.uuid().safeParse(id).success) throw notFound();
  return id;
};

const keyOrThrow = () => {
  const key = secretKey();
  if (!key) throw new HttpError(503, 'unavailable', 'PLANAR_SECRET_KEY не задан');
  return key;
};

/** The decrypted token of the connection in force for a level; null — GitHub is not connected there. */
export async function githubToken(
  db: Pick<Db, 'select' | 'execute'>,
  sc: GithubScope = 'workspace',
  scopeId: string = WORKSPACE_SCOPE_ID,
): Promise<string | null> {
  const r = await resolveConnection(db, sc, scopeId);
  if (!r) return null;
  return tokenOf(r);
}

/** GET /user with the token: the login; 401/403 — 400 with badToken; no answer / other errors — 502. */
async function githubLogin(t: string): Promise<string> {
  const res = await ghGet(t, '/user');
  if (res.status === 401 || res.status === 403) throw invalid(GITHUB_ERRORS.badToken);
  if (!res.ok) throw new HttpError(502, 'unavailable', GITHUB_ERRORS.unavailable);
  const body = (await res.json().catch(() => null)) as { login?: unknown } | null;
  if (typeof body?.login !== 'string' || !body.login)
    throw new HttpError(502, 'unavailable', GITHUB_ERRORS.unavailable);
  return body.login;
}

/** A connection's token; a broken one — 503. */
function tokenOf(c: Connection): string {
  const key = keyOrThrow();
  try {
    return decrypt(c.tokenEnc, key);
  } catch {
    throw new HttpError(503, 'unavailable', 'Токен GitHub не расшифровывается');
  }
}

const repoView = (r: Repo): GithubRepoView => ({
  id: r.id,
  projectId: r.projectId,
  connectionId: r.connectionId,
  repoId: r.repoId,
  fullName: r.fullName,
  defaultBranch: r.defaultBranch,
});

// PLNRAPP-890: github.com connections of the levels workspace / space / project, managed by the instance admin —
// the same levels, choice and rights as the GitLab connections (modules/gitlab)
@Controller('api/github')
export class GithubController {
  constructor(@Inject(CORE) private core: CoreServices) {}

  private admin(req: object) {
    return this.core.requireInstanceAdmin(req, { sessionOnly: true });
  }

  /** The level exists: the workspace (nil uuid), a space or a project. */
  private async level(sc: GithubScope, id: string) {
    if (sc === 'workspace') {
      if (id !== WORKSPACE_SCOPE_ID) throw notFound();
      return;
    }
    const r = await this.core.db.execute(
      sql`select 1 from ${sql.raw(sc === 'space' ? 'spaces' : 'projects')} where id = ${uuidOr404(id)}::uuid`,
    );
    if (!r.rows.length) throw notFound();
  }

  /** Connections available to a level, its own choice and the effective connection. */
  @Get('levels/:scope/:scopeId')
  async levelView(
    @Req() req: object,
    @Param('scope') sc: string,
    @Param('scopeId') id: string,
  ): Promise<GithubLevelView> {
    this.admin(req);
    const s = parseBody(scope, sc) as GithubScope;
    await this.level(s, id);
    const db = this.core.db;
    return {
      connections: (await availableConnections(db, s, id)).map(viewOf),
      choice: await choiceOf(db, s, id),
      effective: (await resolveConnection(db, s, id))?.id ?? null,
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
    const s = parseBody(scope, sc) as GithubScope;
    const b = parseBody(choiceBody, body);
    await this.level(s, id);
    if (b.connectionId === null)
      await this.core.db.delete(C).where(and(eq(C.scope, s), eq(C.scopeId, id)));
    else {
      if (!(await availableConnections(this.core.db, s, id)).some((x) => x.id === b.connectionId))
        throw invalid('Подключение недоступно этому уровню');
      await this.core.db
        .insert(C)
        .values({ scope: s, scopeId: id, connectionId: b.connectionId })
        .onConflictDoUpdate({
          target: [C.scope, C.scopeId],
          set: { connectionId: b.connectionId },
        });
    }
    return { choice: b.connectionId };
  }

  /** Checks the token at GitHub, then saves the connection of the level (encrypted token). */
  @Post('connections')
  async connect(@Req() req: object, @Body() body: unknown) {
    const a = this.admin(req);
    const b = parseBody(connectBody, body);
    await this.level(b.scope, b.scopeId);
    const key = keyOrThrow();
    const login = await githubLogin(b.token);
    const r = await this.core.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(G)
        .values({
          id: uuidv7(),
          scope: b.scope,
          scopeId: b.scopeId,
          login,
          tokenEnc: encrypt(b.token, key),
          connectedBy: a.userId,
        })
        .returning();
      // the own connection of a space / project is what that level uses from now on
      if (b.scope !== 'workspace')
        await tx
          .insert(C)
          .values({ scope: b.scope, scopeId: b.scopeId, connectionId: row!.id })
          .onConflictDoUpdate({ target: [C.scope, C.scopeId], set: { connectionId: row!.id } });
      return row!;
    });
    return { connection: viewOf(r) };
  }

  /** Disconnect: the connection is deleted; levels that chose it fall back to inheriting. */
  @Delete('connections/:id')
  @HttpCode(204)
  async disconnect(@Req() req: object, @Param('id') id: string) {
    this.admin(req);
    const [r] = await this.core.db
      .select({ id: G.id })
      .from(G)
      .where(eq(G.id, uuidOr404(id)));
    if (!r) throw notFound();
    // PLNRAPP-891: as GitLab — not while project repositories are bound through it
    const [bound] = await this.core.db
      .select({ id: R.id })
      .from(R)
      .where(eq(R.connectionId, r.id))
      .limit(1);
    if (bound)
      throw new HttpError(
        409,
        'conflict',
        'К подключению привязаны репозитории проектов — сначала отвяжите их',
      );
    await this.core.db.transaction(async (tx) => {
      await tx.delete(C).where(eq(C.connectionId, r.id));
      await tx.delete(G).where(eq(G.id, r.id));
    });
  }

  // PLNRAPP-891: a project's github.com repositories — the same rights as the GitLab bindings (instance admin)

  private async project(id: string) {
    await this.level('project', id);
    return id;
  }

  /** The project's bound repositories. */
  @Get('projects/:projectId/repos')
  async repos(@Req() req: object, @Param('projectId') projectId: string) {
    this.admin(req);
    await this.project(projectId);
    const rs = await this.core.db
      .select()
      .from(R)
      .where(eq(R.projectId, projectId))
      .orderBy(asc(R.fullName));
    return { repos: rs.map(repoView) };
  }

  /** Repositories the project's connection has access to (all pages), ?q — part of the name. */
  @Get('projects/:projectId/available')
  async available(
    @Req() req: object,
    @Param('projectId') projectId: string,
    @Query('q') q?: string,
  ): Promise<GithubAvailableView> {
    this.admin(req);
    await this.project(projectId);
    const c = await resolveConnection(this.core.db, 'project', projectId);
    if (!c) return { connected: false, repos: [] };
    return { connected: true, repos: await listRepos(tokenOf(c), String(q ?? '').slice(0, 200)) };
  }

  /** Binds a repository by full_name through the project's connection; the same one again — refreshed, no duplicate. */
  @Post('projects/:projectId/repos')
  async bind(@Req() req: object, @Param('projectId') projectId: string, @Body() body: unknown) {
    this.admin(req);
    const b = parseBody(bindBody, body);
    await this.project(projectId);
    const c = await resolveConnection(this.core.db, 'project', projectId);
    if (!c) throw new HttpError(409, 'conflict', GITHUB_ERRORS.notConnected);
    const found = await fetchRepo(tokenOf(c), b.fullName);
    const [r] = await this.core.db
      .insert(R)
      .values({
        id: uuidv7(),
        projectId,
        connectionId: c.id,
        repoId: found.repoId,
        fullName: found.fullName,
        defaultBranch: found.defaultBranch,
      })
      .onConflictDoUpdate({
        target: [R.projectId, R.repoId],
        set: { connectionId: c.id, fullName: found.fullName, defaultBranch: found.defaultBranch },
      })
      .returning();
    return { repo: repoView(r!) };
  }

  /** Unbinds: the binding row is deleted; PLNRAPP-892: its PRs and commits on the project's tasks too. */
  @Delete('repos/:id')
  @HttpCode(204)
  async unbind(@Req() req: object, @Param('id') id: string) {
    this.admin(req);
    const r = await this.core.db
      .delete(R)
      .where(eq(R.id, uuidOr404(id)))
      .returning({ projectId: R.projectId, repoId: R.repoId });
    if (!r.length) throw notFound();
    await this.core.execute(
      this.core.systemUserId(),
      [{ name: 'github.repo.drop', args: { projectId: r[0]!.projectId, repoId: r[0]!.repoId } }],
      { system: true },
    );
  }

  // PLNRAPP-892: a one-off sync of PRs and commits of the bound repositories (the poller and webhooks reuse syncProject)

  private jobApi(): JobApi {
    const c = this.core;
    return {
      db: c.db,
      execute: (...a) => c.execute(...a),
      enqueue: (...a) => c.enqueue(...a),
      systemUserId: c.systemUserId(),
    };
  }

  /** The project's repositories → PRs and commits linked to its tasks; the counts of the linked ones. */
  @Post('projects/:projectId/sync')
  @HttpCode(200)
  async syncRepos(@Req() req: object, @Param('projectId') projectId: string) {
    this.admin(req);
    await this.project(projectId);
    return syncProject(this.jobApi(), projectId);
  }

  /**
   * The task's GitHub tab «refresh»: the repositories of its project. Anyone with access to the project (as the
   * GitLab tab's poll); the module is off in the project — 404.
   */
  @Post('tasks/:taskId/sync')
  @HttpCode(200)
  async syncTask(@Req() req: object, @Param('taskId') taskId: string) {
    const a = this.core.auth(req);
    const r = await this.core.db.execute(
      sql`select t.project_id as "projectId", ('github' = any(p.modules)) as "on",
            project_role(${a.userId}::uuid, t.project_id) as role
          from tasks t join projects p on p.id = t.project_id where t.id = ${uuidOr404(taskId)}::uuid`,
    );
    const t = r.rows[0] as { projectId: string; on: boolean; role: string | null } | undefined;
    if (!t?.role) throw new HttpError(404, 'not_found', 'Задача не найдена');
    if (!t.on) throw new HttpError(404, 'module_disabled', 'Модуль github выключен в проекте');
    return syncProject(this.jobApi(), t.projectId);
  }
}
