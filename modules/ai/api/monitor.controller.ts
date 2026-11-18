// PLNRAPP-500: REST of the engines monitor — the cards and the live log (polled by the cursor of events),
// the history with filters, the manual pass (a workspace admin only).
import { Body, Controller, Get, Inject, Post, Query, Req } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { CORE, HttpError, parseBody, type CoreServices } from '@planar/server-kit';
import {
  ENGINE_IDS,
  ENGINE_RUN_STATES,
  type EngineCard,
  type EngineEventView,
  type EngineHistory,
  type EngineId,
  type EngineMonitorView,
  type EngineRunView,
} from '../shared/index.js';
import { RECONCILE_QUEUE } from './engine.js';
import type { TasksEngineData } from './engines.js';
import { abortRunning } from './monitor.js';
import { RETRO_QUEUE, type RetroData } from './retro.js';
import { aiEnabled } from './run.js';

/** a pass is expected at least this often: reap — every minute, the retro tick — hourly */
const EVERY_MIN: Record<EngineId, number> = { tasks: 1, harness: 60 };
/** no pass for this many periods (+ 2 min) — the scheduler does not run the engine */
const STALL_PERIODS = 3;

type Row = Record<string, unknown>;
const iso = (c: string) =>
  sql.raw(`to_char(${c} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
const scopeQuery = z.object({ projectId: z.uuid().optional() });
const monitorQuery = scopeQuery.extend({ after: z.uuid().optional() });
const historyQuery = scopeQuery.extend({
  engine: z.enum(ENGINE_IDS).optional(),
  state: z.enum(ENGINE_RUN_STATES).optional(),
  /** project — only passes of the project; general — only passes over all projects */
  only: z.enum(['project', 'general']).optional(),
  /** only passes that did something, failed or were aborted */
  active: z.enum(['1', '0']).optional(),
  since: z.iso.datetime().optional(),
  until: z.iso.datetime().optional(),
  cursor: z
    .string()
    .regex(/^[^|]+\|[0-9a-f-]{36}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const runBody = z.object({ engine: z.enum(ENGINE_IDS), projectId: z.uuid().nullable() });

export const statusOf = (
  c: { running: boolean; lastStartAt: string | null; lastState: string | null },
  everyMin: number,
  now = Date.now(),
): EngineCard['status'] => {
  if (c.running) return 'running';
  if (
    !c.lastStartAt ||
    now - new Date(c.lastStartAt).getTime() > (everyMin * STALL_PERIODS + 2) * 60_000
  )
    return 'stalled';
  return c.lastState === 'failed' ? 'error' : 'idle';
};

@Controller('api/ai/engines')
export class EngineController {
  constructor(@Inject(CORE) private core: CoreServices) {}

  /** Who sees the monitor: a project → its admin (the module on) or a workspace admin; none → a workspace admin. */
  private async viewer(req: object, projectId: string | undefined) {
    const a = this.core.auth(req);
    if (a.tokenId) throw new HttpError(403, 'forbidden', 'Только из сессии');
    const instance = a.role === 'owner' || a.role === 'admin';
    if (!projectId) {
      if (!instance) throw new HttpError(403, 'forbidden', 'Нужна роль администратора');
      return { instance };
    }
    const r = (
      await this.core.db.execute(
        sql`select ('ai' = any(p.modules) and (${instance} or project_role(${a.userId}::uuid, p.id) = 'admin')) as ok
            from projects p where p.id = ${projectId}::uuid`,
      )
    ).rows[0];
    if (!r) throw new HttpError(404, 'not_found', 'Не найдено');
    if (!r.ok) throw new HttpError(403, 'forbidden', 'Нужна роль администратора');
    return { instance };
  }

  /** A project view: its own rows and the general ones (no project), never another project's. */
  private seen(col: string, projectId: string | undefined): SQL {
    return projectId
      ? sql`(${sql.raw(col)} is null or ${sql.raw(col)} = ${projectId}::uuid)`
      : sql`true`;
  }

  @Get('monitor')
  async monitor(@Req() req: object, @Query() query: unknown): Promise<EngineMonitorView> {
    const q = parseBody(monitorQuery, query);
    const { instance } = await this.viewer(req, q.projectId);
    const db = this.core.db;
    const engines: EngineCard[] = [];
    for (const engine of ENGINE_IDS) {
      const r = (
        await db.execute(
          sql`select
              (select row_to_json(x) from (select ${this.visible(q.projectId)} as current, ${iso('started_at')} as since
                from ai_engine_runs where engine = ${engine} and state = 'running'
                order by started_at desc limit 1) x) as running,
              (select ${iso('max(started_at)')} from ai_engine_runs where engine = ${engine}) as "lastStartAt",
              (select row_to_json(x) from (select state, error, ${iso('finished_at')} as at from ai_engine_runs
                where engine = ${engine} and finished_at is not null order by finished_at desc limit 1) x) as last,
              (select ${iso('max(finished_at)')} from ai_engine_runs
                where engine = ${engine} and processed > 0 and ${this.seen('project_id', q.projectId)}) as "lastActionAt"`,
        )
      ).rows[0] as {
        running: { current: string | null; since: string } | null;
        lastStartAt: string | null;
        last: { state: string; error: string | null; at: string } | null;
        lastActionAt: string | null;
      };
      engines.push({
        engine,
        status: statusOf(
          { running: !!r.running, lastStartAt: r.lastStartAt, lastState: r.last?.state ?? null },
          EVERY_MIN[engine],
        ),
        current: r.running?.current ?? null,
        runningSince: r.running?.since ?? null,
        lastRunAt: r.last?.at ?? null,
        lastActionAt: r.lastActionAt,
        lastError: r.last?.state === 'failed' ? r.last.error : null,
        everyMin: EVERY_MIN[engine],
      });
    }
    const cols = sql`e.id, e.run_id as "runId", e.engine, e.project_id as "projectId", e.task_id as "taskId",
      e.level, e.text, ${iso('e.at')} as at`;
    const events = (q.after
      ? await db.execute(
          sql`select ${cols} from ai_engine_events e
                where e.id > ${q.after}::uuid and ${this.seen('e.project_id', q.projectId)}
                order by e.id limit 200`,
        )
      : await db.execute(
          sql`select * from (select ${cols} from ai_engine_events e
                where ${this.seen('e.project_id', q.projectId)} order by e.id desc limit 50) x order by id`,
        )
    ).rows as unknown as EngineEventView[];
    return { enabled: await aiEnabled(db), canRun: instance, engines, events };
  }

  /** `current` of a running pass, unless it is about another project. */
  private visible(projectId: string | undefined): SQL {
    return projectId
      ? sql`case when current_project_id is null or current_project_id = ${projectId}::uuid then current end`
      : sql`current`;
  }

  @Get('runs')
  async runs(@Req() req: object, @Query() query: unknown): Promise<EngineHistory> {
    const q = parseBody(historyQuery, query);
    await this.viewer(req, q.projectId);
    const where: SQL[] = [this.seen('r.project_id', q.projectId)];
    if (q.only === 'general') where.push(sql`r.project_id is null`);
    if (q.only === 'project')
      where.push(
        q.projectId ? sql`r.project_id = ${q.projectId}::uuid` : sql`r.project_id is not null`,
      );
    if (q.engine) where.push(sql`r.engine = ${q.engine}`);
    if (q.state) where.push(sql`r.state = ${q.state}`);
    if (q.active === '1')
      where.push(sql`(r.processed > 0 or r.state <> 'done' or r.trigger = 'manual')`);
    if (q.since) where.push(sql`r.started_at >= ${q.since}::timestamptz`);
    if (q.until) where.push(sql`r.started_at < ${q.until}::timestamptz`);
    if (q.cursor) {
      const [at, id] = q.cursor.split('|') as [string, string];
      where.push(sql`(r.started_at, r.id) < (${at}::timestamptz, ${id}::uuid)`);
    }
    const rows = (
      await this.core.db.execute(
        sql`select r.id, r.engine, r.job, r.project_id as "projectId", p.name as "projectName", r.trigger,
              u.name as "userName", r.state, r.processed, r.error,
              ${iso('r.started_at')} as "startedAt", ${iso('r.finished_at')} as "finishedAt"
            from ai_engine_runs r left join projects p on p.id = r.project_id left join users u on u.id = r.user_id
            where ${sql.join(where, sql` and `)}
            order by r.started_at desc, r.id desc limit ${q.limit + 1}`,
      )
    ).rows as Row[];
    const page = rows.slice(0, q.limit) as unknown as EngineRunView[];
    return {
      runs: page,
      next: rows.length > q.limit ? `${page.at(-1)!.startedAt}|${page.at(-1)!.id}` : null,
    };
  }

  /**
   * A manual pass: a workspace admin only; all projects or one. The running passes of the engine are aborted
   * (they stop at their next step) and the new one is queued at once.
   */
  @Post('run')
  async run(@Req() req: object, @Body() body: unknown) {
    const a = this.core.requireInstanceAdmin(req, { sessionOnly: true });
    const b = parseBody(runBody, body);
    const db = this.core.db;
    if (b.projectId) {
      const p = (
        await db.execute(
          sql`select 'ai' = any(modules) as ai from projects where id = ${b.projectId}::uuid`,
        )
      ).rows[0];
      if (!p?.ai) throw new HttpError(404, 'not_found', 'Не найдено');
    }
    const aborted = await abortRunning(db, b.engine);
    if (b.engine === 'tasks') {
      await this.core.enqueue(
        RECONCILE_QUEUE,
        { trigger: 'manual', projectId: b.projectId, userId: a.userId } satisfies TasksEngineData,
        { singletonKey: `${RECONCILE_QUEUE}:manual`, upsert: true },
      );
      return { aborted, queued: 1 };
    }
    // harness: the retro of the project, or of every project where it is on
    const ids = b.projectId
      ? [b.projectId]
      : (
          (
            await db.execute(
              sql`select r.project_id as id from ai_retro r join projects p on p.id = r.project_id
                  where r.enabled and r.task_id is not null and 'ai' = any(p.modules)`,
            )
          ).rows as { id: string }[]
        ).map((r) => r.id);
    for (const projectId of ids)
      await this.core.enqueue(
        RETRO_QUEUE,
        { kind: 'run', projectId, trigger: 'manual', userId: a.userId } satisfies RetroData,
        { singletonKey: `retro:${projectId}`, upsert: true },
      );
    return { aborted, queued: ids.length };
  }
}
