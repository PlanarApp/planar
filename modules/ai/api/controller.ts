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
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  CORE,
  encrypt,
  HttpError,
  parseBody,
  secretKey,
  type CoreServices,
} from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import {
  AI_PROVIDERS,
  AI_SCOPES,
  AI_RUN_STATES,
  INSTANCE_SCOPE_ID,
  MAX_RESTARTS,
  type AiConnectionView,
  type AiLimits,
  type AiMonitor,
  type AiMonitorRun,
  type AiRunDetails,
  type AiRunView,
  type AiScope,
} from '../shared/index.js';
import {
  AI_QUEUE,
  aiEnabled,
  defaultLimits,
  keyOf,
  projectLimits,
  usedToday,
  type AiRunData,
} from './run.js';
import { resolveConnection, secretOf, viewOf } from './connections.js';
import { checkConnection, ConnectionCheckFailed, type LlmConnection } from './llm.js';
import { aiConnections as C } from './schema.js';

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
const price = z.number().min(0).max(1_000_000);
const putBody = z
  .object({
    scope: z.enum(AI_SCOPES),
    scopeId: z.uuid().optional(),
    provider: z.enum(AI_PROVIDERS),
    baseUrl: baseUrl.nullish(),
    /** omitted on an update: the saved key stays */
    apiKey: z.string().min(1).max(500).optional(),
    model: z.string().min(1).max(200),
    priceIn: price.nullish(),
    priceOut: price.nullish(),
  })
  .refine((b) => b.provider !== 'openai-compatible' || !!b.baseUrl, {
    message: 'для openai-compatible нужен baseUrl',
    path: ['baseUrl'],
  })
  .refine((b) => (b.scope === 'instance') === (b.scopeId === undefined), {
    message: 'scopeId нужен у space и project и не нужен у instance',
    path: ['scopeId'],
  });
const listQuery = z.object({ scope: z.enum(AI_SCOPES), scopeId: z.uuid().optional() });

const nf = () => new HttpError(404, 'not_found', 'Не найдено');

type Row = Record<string, unknown>;
// ISO with microseconds: a timestamp as text keeps the precision the cursor needs
const iso = (c: string) =>
  sql.raw(`to_char(${c} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
const runCols = sql`r.id, r.task_id as "taskId", r.project_id as "projectId", r.kind, r.action_id as "actionId",
  (select a.name from ai_actions a where a.id = r.action_id) as "actionName", r.state, r.chain_depth as "chainDepth",
  r.restart_of as "restartOf", r.input_tokens as "inputTokens", r.output_tokens as "outputTokens", r.cost,
  ${iso('r.created_at')} as "createdAt", ${iso('r.updated_at')} as "updatedAt"`;
const runView = (r: Row) => r as unknown as AiRunView;
const uuidP = z.uuid();
const runsQuery = z.object({
  state: z.enum(AI_RUN_STATES).optional(),
  projectId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.iso.datetime().optional(),
});
const limitsBody = z.object({
  dailyTokens: z.number().int().min(1).max(1e12).nullable(),
  dailyCost: z.number().min(0.01).max(1e9).nullable(),
});

@Controller('api/ai')
export class AiController {
  constructor(@Inject(CORE) private core: CoreServices) {}

  /** Admin of the level: instance — owner/admin; space — admin of the space; project — admin of the project. Session only. */
  private async admin(req: object, scope: AiScope, scopeId: string) {
    const a = this.core.auth(req);
    if (a.tokenId) throw new HttpError(403, 'forbidden', 'Только из сессии');
    if (scope === 'instance') {
      this.core.requireInstanceAdmin(req, { sessionOnly: true });
      return;
    }
    const q =
      scope === 'space'
        ? sql`select (u.role in ('owner', 'admin') or sm.role = 'admin') as ok
            from spaces s left join users u on u.id = ${a.userId}::uuid
            left join space_members sm on sm.space_id = s.id and sm.user_id = ${a.userId}::uuid
            where s.id = ${scopeId}::uuid`
        : sql`select (project_role(${a.userId}::uuid, p.id) = 'admin'
              and 'ai' = any(p.modules)) as ok
            from projects p where p.id = ${scopeId}::uuid`;
    const r = await this.core.db.execute(q);
    // no such space / project and no right look the same
    if (!r.rows[0]) throw nf();
    if (!r.rows[0].ok) throw new HttpError(403, 'forbidden', 'Нужна роль администратора');
  }

  /**
   * D7: a person sees the runs of a task when they have access to its project, the module is on there, and
   * they are an admin of the project, the author of the task or its assignee. Else — the same 404 as a missing task.
   */
  private async seeTask(req: object, taskId: string) {
    const a = this.core.auth(req);
    if (a.tokenId) throw new HttpError(403, 'forbidden', 'Только из сессии');
    if (!uuidP.safeParse(taskId).success) throw nf();
    const r = await this.core.db.execute(
      sql`select t.project_id as "projectId" from tasks t join projects p on p.id = t.project_id
          where t.id = ${taskId}::uuid and 'ai' = any(p.modules)
            and project_role(${a.userId}::uuid, p.id) is not null
            and (project_role(${a.userId}::uuid, p.id) = 'admin' or t.created_by = ${a.userId}::uuid
              or exists (select 1 from task_assignees ta where ta.task_id = t.id and ta.user_id = ${a.userId}::uuid))`,
    );
    if (!r.rows[0]) throw nf();
  }

  /** The run row with the task access checked. */
  private async runOf(req: object, id: string) {
    if (!uuidP.safeParse(id).success) throw nf();
    const r = (
      await this.core.db.execute(
        sql`select ${runCols}, r.log, r.rule_id as "ruleId", r.item_id as "itemId" from ai_runs r where r.id = ${id}::uuid`,
      )
    ).rows[0] as Row | undefined;
    if (!r) {
      // no run and no right look the same, session check included
      this.core.auth(req);
      throw nf();
    }
    await this.seeTask(req, r.taskId as string);
    return r;
  }

  @Get('tasks/:taskId/runs')
  async taskRuns(
    @Req() req: object,
    @Param('taskId') taskId: string,
  ): Promise<{ runs: AiRunView[] }> {
    await this.seeTask(req, taskId);
    const r = await this.core.db.execute(
      sql`select ${runCols} from ai_runs r where r.task_id = ${taskId}::uuid order by r.created_at desc, r.id desc limit 50`,
    );
    return { runs: r.rows.map(runView) };
  }

  @Get('runs/:id')
  async runDetails(@Req() req: object, @Param('id') id: string): Promise<{ run: AiRunDetails }> {
    const run = await this.runOf(req, id);
    delete run.ruleId;
    delete run.itemId;
    return { run: run as unknown as AiRunDetails };
  }

  @Post('runs/:id/stop')
  @HttpCode(204)
  async stop(@Req() req: object, @Param('id') id: string) {
    await this.runOf(req, id);
    await this.core.db.execute(
      sql`update ai_runs set state = 'cancelled', updated_at = now()
          where id = ${id}::uuid and state in ('running', 'waiting_human')`,
    );
  }

  /** The run again from its own data; the new run (made by the queue) points back by restartOf. */
  @Post('runs/:id/restart')
  async restart(@Req() req: object, @Param('id') id: string): Promise<{ runId: string }> {
    const r = await this.runOf(req, id);
    if (!(await aiEnabled(this.core.db)))
      throw new HttpError(409, 'conflict', 'ИИ выключен администратором');
    const n = (
      await this.core.db.execute(
        sql`with recursive c as (select id, restart_of from ai_runs where id = ${id}::uuid
            union all select r.id, r.restart_of from ai_runs r join c on r.id = c.restart_of)
            select count(*)::int - 1 as n from c`,
      )
    ).rows[0]!.n as number;
    if (n >= MAX_RESTARTS)
      throw new HttpError(409, 'conflict', `Не больше ${MAX_RESTARTS} перезапусков подряд`);
    const taskId = r.taskId as string;
    const restartOf = id;
    const runId = uuidv7();
    const d: AiRunData | null =
      r.kind === 'action'
        ? r.actionId
          ? {
              kind: 'action',
              taskId,
              actionId: r.actionId as string,
              ruleId: r.ruleId as string | null,
              restartOf,
              runId,
            }
          : null
        : r.kind === 'checklist'
          ? { kind: 'checklist', taskId, restartOf, runId }
          : r.itemId
            ? {
                kind: r.kind as 'comment' | 'mention',
                taskId,
                itemId: r.itemId as string,
                restartOf,
                runId,
              }
            : null;
    if (!d) throw new HttpError(409, 'conflict', 'Прогон нельзя перезапустить');
    await this.core.enqueue(AI_QUEUE, d, { singletonKey: keyOf(d), upsert: true });
    return { runId };
  }

  @Get('monitor')
  async monitor(@Req() req: object, @Query() query: unknown): Promise<AiMonitor> {
    this.core.requireInstanceAdmin(req, { sessionOnly: true });
    const q = parseBody(runsQuery, query);
    const rows = (
      await this.core.db.execute(
        sql`select ${runCols}, p.key || '-' || t.number as "taskKey", t.title as "taskTitle", p.name as "projectName"
            from ai_runs r join tasks t on t.id = r.task_id join projects p on p.id = r.project_id
            where true ${q.state ? sql`and r.state = ${q.state}` : sql``}
            ${q.projectId ? sql`and r.project_id = ${q.projectId}::uuid` : sql``}
            ${q.cursor ? sql`and r.created_at < ${q.cursor}::timestamptz` : sql``}
            order by r.created_at desc, r.id desc limit ${q.limit + 1}`,
      )
    ).rows as Row[];
    const page = rows.slice(0, q.limit);
    const load = (
      await this.core.db.execute(
        sql`select count(*) filter (where state = 'running')::int as running,
            count(*) filter (where state = 'waiting_human')::int as waiting from ai_runs
            where state in ('running', 'waiting_human')`,
      )
    ).rows[0] as { running: number; waiting: number };
    return {
      runs: page as unknown as AiMonitorRun[],
      next: rows.length > q.limit ? (page.at(-1)!.createdAt as string) : null,
      load,
      today: await usedToday(this.core.db),
      enabled: await aiEnabled(this.core.db),
      limits: defaultLimits(),
    };
  }

  @Get('settings')
  async settings(@Req() req: object) {
    this.core.requireInstanceAdmin(req, { sessionOnly: true });
    return { enabled: await aiEnabled(this.core.db) };
  }

  @Put('settings')
  async setSettings(@Req() req: object, @Body() body: unknown) {
    this.core.requireInstanceAdmin(req, { sessionOnly: true });
    const { enabled } = parseBody(z.object({ enabled: z.boolean() }), body);
    await this.core.db.execute(
      sql`insert into ai_settings (id, enabled) values (1, ${enabled})
          on conflict (id) do update set enabled = excluded.enabled`,
    );
    return { enabled };
  }

  private async limitsOf(projectId: string) {
    const l = await projectLimits(this.core.db, projectId);
    return {
      ...l.own,
      effective: l.effective as AiLimits,
      usedToday: await usedToday(this.core.db, projectId),
    };
  }

  @Get('limits')
  async limits(@Req() req: object, @Query() query: unknown) {
    const { projectId } = parseBody(z.object({ projectId: z.uuid() }), query);
    await this.admin(req, 'project', projectId);
    return this.limitsOf(projectId);
  }

  @Put('limits')
  async setLimits(@Req() req: object, @Query() query: unknown, @Body() body: unknown) {
    const { projectId } = parseBody(z.object({ projectId: z.uuid() }), query);
    const b = parseBody(limitsBody, body);
    await this.admin(req, 'project', projectId);
    await this.core.db.execute(
      sql`insert into ai_project_limits (project_id, daily_tokens, daily_cost) values (${projectId}::uuid, ${b.dailyTokens}, ${b.dailyCost})
          on conflict (project_id) do update set daily_tokens = excluded.daily_tokens,
            daily_cost = excluded.daily_cost, updated_at = now()`,
    );
    return this.limitsOf(projectId);
  }

  /** The level's own connection and the one in force for it (project: nearest of project, space, instance). */
  @Get('connections')
  async list(@Req() req: object, @Query() query: unknown) {
    const q = parseBody(listQuery, query);
    const scopeId = q.scope === 'instance' ? INSTANCE_SCOPE_ID : q.scopeId;
    if (!scopeId) throw new HttpError(400, 'invalid_request', 'scopeId обязателен');
    await this.admin(req, q.scope, scopeId);
    const [own] = await this.core.db.select().from(C).where(eqScope(q.scope, scopeId));
    let effective: Awaited<ReturnType<typeof resolveConnection>> = null;
    if (!own && q.scope === 'project') effective = await resolveConnection(this.core.db, scopeId);
    else if (!own && q.scope === 'space')
      effective =
        (await this.core.db.select().from(C).where(eqScope('instance', INSTANCE_SCOPE_ID)))[0] ??
        null;
    return {
      connection: own ? viewOf(own) : null,
      effective: effective ? viewOf(effective) : null,
    };
  }

  /** Create or replace the level's connection; the test call goes first — a failed check saves nothing. */
  @Put('connections')
  async save(@Req() req: object, @Body() body: unknown): Promise<{ connection: AiConnectionView }> {
    const b = parseBody(putBody, body);
    const scopeId = b.scope === 'instance' ? INSTANCE_SCOPE_ID : b.scopeId!;
    await this.admin(req, b.scope, scopeId);
    const key = secretKey();
    if (!key) throw new HttpError(503, 'unavailable', 'PLANAR_SECRET_KEY не задан');
    const [had] = await this.core.db.select().from(C).where(eqScope(b.scope, scopeId));
    let apiKey = b.apiKey;
    if (!apiKey) {
      if (!had) throw new HttpError(400, 'invalid_request', 'apiKey обязателен');
      apiKey = secretOf(had).apiKey;
    }
    const conn: LlmConnection = {
      provider: b.provider,
      baseUrl: b.baseUrl ?? null,
      apiKey,
      model: b.model,
      priceIn: b.priceIn ?? null,
      priceOut: b.priceOut ?? null,
    };
    try {
      await checkConnection(conn);
    } catch (e) {
      if (e instanceof ConnectionCheckFailed && e.kind === 'rejected')
        throw new HttpError(502, 'unavailable', 'Провайдер отклонил ключ');
      throw new HttpError(502, 'unavailable', 'Провайдер недоступен');
    }
    const v = {
      provider: conn.provider,
      baseUrl: conn.baseUrl,
      model: conn.model,
      priceIn: conn.priceIn,
      priceOut: conn.priceOut,
      keyEnc: b.apiKey ? encrypt(b.apiKey, key) : had!.keyEnc,
    };
    const [r] = await this.core.db
      .insert(C)
      .values({ id: uuidv7(), scope: b.scope, scopeId, ...v })
      .onConflictDoUpdate({ target: [C.scope, C.scopeId], set: { ...v, updatedAt: sql`now()` } })
      .returning();
    return { connection: viewOf(r!) };
  }

  @Delete('connections/:id')
  @HttpCode(204)
  async remove(@Req() req: object, @Param('id') id: string) {
    if (!z.uuid().safeParse(id).success) throw nf();
    const [c] = await this.core.db.select().from(C).where(eq(C.id, id));
    if (!c) throw nf();
    await this.admin(req, c.scope as AiScope, c.scopeId);
    await this.core.db.delete(C).where(eq(C.id, id));
  }
}

const eqScope = (scope: AiScope, scopeId: string) =>
  sql`${C.scope} = ${scope} and ${C.scopeId} = ${scopeId}::uuid`;
