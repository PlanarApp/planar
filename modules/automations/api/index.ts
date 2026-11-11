import { Controller, Get, Inject, Injectable, Module, Param, Query, Req } from '@nestjs/common';
import { CronExpressionParser } from 'cron-parser';
import { sql } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import {
  CORE,
  HttpError,
  type CoreServices,
  type JobApi,
  type JobDef,
  type Q,
  type ModuleHookApi,
} from '@planar/server-kit';
import {
  matchFilter,
  resolveDate,
  textToDoc,
  uuidv7,
  widenByName,
  type AfterMutationCtx,
  type BackendModuleManifest,
  type Filter,
  type FilterCtx,
  type FilterTask,
  type MutationWrite,
} from '@planar/shared';
import { enqueueWebhookEvent } from '@planar/module-webhooks/api';
import { shared, type Action, type Rule, type Trigger } from '../shared/index.js';

// CoreServices is provided by Nest (AutomationsBoot); a pg-boss job is not a provider
let core: CoreServices | undefined;

const MAX_DEPTH = 3;
const RUN_QUEUE = 'automations.run';
/** the queue of module ai (its job data: modules/ai/api/run.ts) */
const AI_QUEUE = 'ai.run';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RunData {
  ruleId: string;
  taskId: string;
  depth: number;
  eventAt: string;
  /** the event is a change by this AI run: a run it starts continues its chain */
  aiRunId?: string;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
type Row = Record<string, unknown>;

/** Events for mutation records: job, trigger type, details to match against the trigger parameters. */
interface Event {
  taskId: string;
  projectId?: string;
  match: (t: Trigger) => boolean;
}

function eventsOf(writes: MutationWrite[]): Event[] {
  const out: Event[] = [];
  for (const w of writes) {
    const a = w.after as Row | null;
    const b = w.before as Row | null;
    if (w.entity === 'tasks' && w.op === 'put' && a) {
      const projectId = a.projectId as string;
      const taskId = a.id as string;
      if (!b) {
        out.push({ taskId, projectId, match: (t) => t.type === 'task.created' });
        continue;
      }
      if (b.statusId !== a.statusId)
        out.push({
          taskId,
          projectId,
          match: (t) =>
            t.type === 'task.status_changed' &&
            (!t.from || t.from.includes(b.statusId as string)) &&
            (!t.to || t.to.includes(a.statusId as string)),
        });
      const changed = (f: string) =>
        f.startsWith('field:')
          ? !same(
              (b.fields as Row | undefined)?.[f.slice(6)],
              (a.fields as Row | undefined)?.[f.slice(6)],
            )
          : !same(b[f], a[f]);
      out.push({
        taskId,
        projectId,
        match: (t) => t.type === 'task.field_changed' && changed(t.field),
      });
    } else if (w.entity === 'taskAssignees') {
      const r = (a ?? b) as Row | null;
      if (!r || (w.op === 'put' && b)) continue;
      const added = w.op === 'put';
      out.push({
        taskId: r.taskId as string,
        match: (t) =>
          t.type === 'task.assignee_changed' && (!t.userId || (added && t.userId === r.userId)),
      });
    } else if (w.entity === 'comments' && w.op === 'put' && a && !b) {
      out.push({ taskId: a.taskId as string, match: (t) => t.type === 'comment.added' });
    }
  }
  return out;
}

/** A person acted: not the system, not a rule or AI run; a personal token counts as the person. */
async function isHuman(ctx: AfterMutationCtx, api: ModuleHookApi) {
  if (ctx.system || ctx.origin) return false;
  const [u] = (
    await api.q.execute(sql`select deactivated_at as d, bot from users where id = ${ctx.userId}`)
  ).rows as { d: string | null; bot: boolean }[];
  return !!u && !u.d && !u.bot;
}

async function afterMutation(writes: MutationWrite[], ctx: AfterMutationCtx, api: ModuleHookApi) {
  const depth = (ctx.origin?.depth ?? 0) + 1;
  if (depth > MAX_DEPTH) return;
  let human: Promise<boolean> | undefined;
  const projects = new Map<string, string | null>();
  const rulesOf = new Map<string, Rule[]>();
  const queued = new Set<string>();
  for (const e of eventsOf(writes)) {
    let projectId = e.projectId;
    if (!projectId) {
      if (!projects.has(e.taskId))
        projects.set(
          e.taskId,
          ((await api.sys.get('tasks', e.taskId))?.projectId as string | undefined) ?? null,
        );
      projectId = projects.get(e.taskId) ?? undefined;
    }
    if (!projectId) continue; // job deleted
    if (!rulesOf.has(projectId))
      rulesOf.set(
        projectId,
        (await api.sys.scan('automationsRules' as never, {
          index: 'projectId',
          eq: projectId,
        })) as unknown as Rule[],
      );
    for (const r of rulesOf.get(projectId)!) {
      const key = `${r.id}:${e.taskId}`;
      // the rule does not fire on its own action
      if (!r.enabled || r.id === ctx.origin?.ruleId || queued.has(key) || !e.match(r.trigger))
        continue;
      if ('byHuman' in r.trigger && r.trigger.byHuman && !(await (human ??= isHuman(ctx, api))))
        continue;
      queued.add(key);
      await api.enqueue(RUN_QUEUE, {
        ruleId: r.id,
        taskId: e.taskId,
        depth,
        eventAt: ctx.now,
        ...(ctx.origin?.aiRunId && { aiRunId: ctx.origin.aiRunId }),
      });
    }
  }
}

const rows = async (api: JobApi, q: ReturnType<typeof sql>) =>
  (await api.db.execute(q)).rows as Row[];

const record = (
  api: JobApi,
  d: RunData,
  status: 'ok' | 'skipped' | 'error',
  error: string | null = null,
) =>
  api.db.execute(
    sql`insert into automations_runs (id, rule_id, task_id, depth, status, error)
        values (${uuidv7()}, ${d.ruleId}, ${d.taskId}, ${d.depth}, ${status}, ${error})`,
  );

function tzOrUtc(v: unknown): string {
  try {
    if (typeof v === 'string') return (new Intl.DateTimeFormat('en-CA', { timeZone: v }), v);
  } catch {
    /* wrong zone — UTC */
  }
  return 'UTC';
}
const todayIn = (timeZone: string, now: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);

async function instanceTz(api: JobApi) {
  const [s] = await rows(api, sql`select value from settings where id = 'timezone'`);
  return tzOrUtc(s?.value);
}

async function today(api: JobApi, now = new Date()) {
  return todayIn(await instanceTz(api), now);
}

/** Once per (rule, task, slot): a record in automations_fired before enqueueing. */
async function fire(api: JobApi, ruleId: string, taskId: string, slot: string, now: Date) {
  const fired = await rows(
    api,
    sql`insert into automations_fired (rule_id, task_id, slot) values (${ruleId}, ${taskId}, ${slot})
        on conflict do nothing returning rule_id`,
  );
  if (fired.length)
    await api.enqueue(RUN_QUEUE, { ruleId, taskId, depth: 1, eventAt: now.toISOString() });
}

async function loadTask(api: JobApi, taskId: string) {
  const [t] = await rows(
    api,
    sql`select id, space_id as "spaceId", project_id as "projectId", status_id as "statusId",
        title, priority, due_date::text as "dueDate", created_by as "createdBy", fields,
        cycle_id as "cycleId" from tasks where id = ${taskId}`,
  );
  if (!t) return undefined;
  const ids = async (table: string, col: string) =>
    (
      await rows(
        api,
        sql`select ${sql.raw(col)} as v from ${sql.raw(table)} where task_id = ${taskId}`,
      )
    ).map((r) => r.v as string);
  return {
    ...t,
    assigneeIds: await ids('task_assignees', 'user_id'),
    labelIds: await ids('task_labels', 'label_id'),
  } as unknown as FilterTask;
}

type Status = { id: string; category: string; rank: string };

async function toMutations(api: JobApi, rule: Rule, task: FilterTask, statuses: Status[]) {
  const now = await today(api);
  const muts: { name: string; args: unknown }[] = [];
  const upd = (args: object) => muts.push({ name: 'task.update', args: { id: task.id, ...args } });
  for (const a of rule.actions as Action[]) {
    switch (a.type) {
      case 'set_status':
        upd({ statusId: a.statusId });
        break;
      case 'assign':
        muts.push({
          name: 'task.assign',
          args: { id: uuidv7(), taskId: task.id, userId: a.userId },
        });
        break;
      case 'unassign':
        muts.push({ name: 'task.unassign', args: { taskId: task.id, userId: a.userId } });
        break;
      case 'add_label':
        muts.push({
          name: 'task.addLabel',
          args: { id: uuidv7(), taskId: task.id, labelId: a.labelId },
        });
        break;
      case 'remove_label':
        muts.push({ name: 'task.removeLabel', args: { taskId: task.id, labelId: a.labelId } });
        break;
      case 'set_field': {
        if (a.field.startsWith('field:')) {
          muts.push({
            name: 'task.setField',
            args: { taskId: task.id, fieldId: a.field.slice(6), value: a.value },
          });
        } else if (a.field === 'priority') upd({ priority: a.value });
        else {
          const v = a.value === null ? null : resolveDate(String(a.value), now);
          if (v === null && a.value !== null) throw new Error(`дата: ${String(a.value)}`);
          upd({ [a.field]: v });
        }
        break;
      }
      case 'add_comment': {
        const logins = [...a.text.matchAll(/@([\w.-]+)/g)].map((m) => m[1]!);
        const users = logins.length
          ? ((await rows(
              api,
              sql`select id, login from users where login in (${sql.join(
                logins.map((l) => sql`${l}`),
                sql`, `,
              )})`,
            )) as { id: string; login: string }[])
          : [];
        muts.push({
          name: 'comment.create',
          args: { id: uuidv7(), taskId: task.id, body: textToDoc(a.text, users) },
        });
        break;
      }
      case 'move_to_project':
        upd({ projectId: a.projectId, ...(a.statusId && { statusId: a.statusId }) });
        break;
      case 'send_webhook':
      case 'ai_run':
        break; // run inside the transaction of actions (run)
      case 'create_subtask': {
        const first = (c: string) => statuses.find((s) => s.category === c);
        const [last] = await rows(
          api,
          sql`select max(rank collate "C") as r from tasks where parent_id = ${task.id}`,
        );
        muts.push({
          name: 'task.create',
          args: {
            id: uuidv7(),
            projectId: task.projectId,
            parentId: task.id,
            statusId: (first('todo') ?? first('backlog') ?? statuses[0])!.id,
            title: a.title,
            rank: generateKeyBetween((last?.r as string | null) ?? null, null),
          },
        });
        break;
      }
    }
  }
  return muts;
}

async function checkWebhooks(q: Q, subs: string[]) {
  for (const id of subs) {
    const [s] = (await q.execute(sql`select active from webhooks_subscriptions where id = ${id}`))
      .rows as { active: boolean }[];
    if (!s?.active) throw new Error(`вебхук ${id}: подписка неактивна или не найдена`);
  }
}

async function sendWebhooks(
  api: Pick<ModuleHookApi, 'enqueue'>,
  q: Q,
  subs: string[],
  d: Pick<RunData, 'ruleId' | 'taskId'>,
) {
  const [t] = (await q.execute(sql`select row_to_json(t) as r from tasks t where id = ${d.taskId}`))
    .rows as { r: Row }[];
  if (!t) throw new Error('задача удалена');
  const row = Object.fromEntries(
    Object.entries(t.r).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v,
    ]),
  );
  const [task] = await core!.toV1Tasks(q, [row]);
  for (const id of subs) {
    await enqueueWebhookEvent({ q, enqueue: api.enqueue } as never, id, 'automation.fired', {
      ruleId: d.ruleId,
      task,
    });
  }
}

/**
 * The rule is on (module too) and its conditions hold for the task now; null — no.
 * Also for module ai: the run rechecks the rule after its debounce.
 */
export async function matched(api: JobApi, ruleId: string, taskId: string) {
  const [r] = await rows(
    api,
    sql`select r.id, r.enabled, r.conditions, r.actions, r.project_id as "projectId" from automations_rules r
        join projects p on p.id = r.project_id and 'automations' = any(p.modules) where r.id = ${ruleId}`,
  );
  const task = r?.enabled ? await loadTask(api, taskId) : undefined;
  if (!r || !task) return null;
  const rule = r as unknown as Rule;
  const statuses = (await rows(
    api,
    sql`select id, space_id as "spaceId", category, rank from statuses where project_id = ${task.projectId} order by rank`,
  )) as unknown as Status[];
  const fieldDefs = await rows(
    api,
    sql`select id, project_id as "projectId", type from field_defs where project_id = ${task.projectId}`,
  );
  const cycles = await rows(
    api,
    sql`select id, project_id as "projectId", start_date::text as "startDate",
        end_date::text as "endDate", closed_at::text as "closedAt"
        from sprints_cycles where project_id = ${task.projectId}`,
  );
  const ctx: FilterCtx = {
    cycles: cycles as never,
    statuses: statuses as never,
    fieldDefs: fieldDefs as never,
    userId: api.systemUserId,
    today: await today(api),
  };
  // the condition may hold same-named statuses/labels of another project of the space (picker merges them)
  const named = (table: string) =>
    rows(
      api,
      sql`select id, name from ${sql.raw(table)} where space_id = ${task.spaceId}`,
    ) as Promise<{ id: string; name: string }[]>;
  const conditions = widenByName(
    rule.conditions as Filter,
    await named('statuses'),
    await named('labels'),
  );
  return matchFilter(task, conditions, ctx) ? { rule, task, statuses } : null;
}

/**
 * ai_run → a job of module ai (PLNRAPP-168): debounced per (task, action) — a new event within 60 s replaces
 * the queued job. statusId — after this rule's own actions: the run goes only if the task is still there.
 */
async function enqueueAi(q: Q, enqueue: ModuleHookApi['enqueue'], ids: string[], d: RunData) {
  const [t] = (await q.execute(sql`select status_id as s from tasks where id = ${d.taskId}`))
    .rows as { s: string }[];
  if (!t) return;
  for (const actionId of ids)
    await enqueue(
      AI_QUEUE,
      {
        kind: 'action',
        taskId: d.taskId,
        actionId,
        ruleId: d.ruleId,
        statusId: t.s,
        parentRunId: d.aiRunId ?? null,
      },
      { singletonKey: `${d.taskId}:${actionId}`, upsert: true, startAfter: 60 },
    );
}

async function run(d: RunData, api: JobApi) {
  const m = await matched(api, d.ruleId, d.taskId);
  if (!m) return void (await record(api, d, 'skipped'));
  const { rule, task, statuses } = m;
  try {
    const muts = await toMutations(api, rule, task, statuses);
    const hooks = (rule.actions as Action[]).flatMap((a) =>
      a.type === 'send_webhook' ? [a.subscriptionId] : [],
    );
    const ai = (rule.actions as Action[]).flatMap((a) =>
      a.type === 'ai_run' ? [a.aiActionId] : [],
    );
    await api.execute(api.systemUserId, muts, {
      system: true,
      origin: { ruleId: d.ruleId, depth: d.depth },
      // an inactive/nonexistent subscription rolls back everything up to the actions
      prepare: hooks.length ? (q) => checkWebhooks(q, hooks) : undefined,
      // delivery — in the same transaction after all actions; a failure rolls back the actions, the run = error
      after: async (q, enqueue) => {
        if (hooks.length) await sendWebhooks({ enqueue }, q, hooks, d);
        if (ai.length) await enqueueAi(q, enqueue, ai, d);
      },
    });
  } catch (e) {
    return void (await record(api, d, 'error', e instanceof Error ? e.message : String(e)));
  }
  await record(api, d, 'ok');
}

/** Once per (rule, job, dueDate): a record in automations_due_fired before enqueueing. */
async function due(data: { now?: string }, api: JobApi) {
  const now = data.now ? new Date(data.now) : new Date();
  const day = await today(api, now);
  const rules = await rows(
    api,
    sql`select r.id, r.project_id as "projectId", r.trigger from automations_rules r
        join projects p on p.id = r.project_id and 'automations' = any(p.modules)
        where r.enabled and r.trigger->>'type' = 'task.due'`,
  );
  for (const r of rules) {
    const days = (r.trigger as { daysBefore: number }).daysBefore;
    const tasks = await rows(
      api,
      sql`select t.id, t.due_date::text as "dueDate" from tasks t
          join statuses s on s.id = t.status_id
          where t.project_id = ${r.projectId as string} and t.due_date is not null
            and s.category not in ('done', 'cancelled')
            and t.due_date - ${days}::int <= ${day}::date`,
    );
    for (const t of tasks) {
      const fired = await rows(
        api,
        sql`insert into automations_due_fired (rule_id, task_id, due_date)
            values (${r.id as string}, ${t.id as string}, ${t.dueDate as string})
            on conflict do nothing returning rule_id`,
      );
      if (fired.length)
        await api.enqueue(RUN_QUEUE, {
          ruleId: r.id,
          taskId: t.id,
          depth: 1,
          eventAt: now.toISOString(),
        });
    }
  }
  await scan(api, now, day);
}

/**
 * stale / unassigned / waiting_human / start_reached — one query over all rules and open tasks;
 * slot — the moment the condition is counted from, so a trigger fires again only after it resets.
 */
async function scan(api: JobApi, now: Date, day: string) {
  const at = now.toISOString();
  const found = await rows(
    api,
    sql`with r as (
          select r.id, r.project_id, r.trigger from automations_rules r
          join projects p on p.id = r.project_id and 'automations' = any(p.modules)
          where r.enabled and r.trigger->>'type' in
            ('task.stale', 'task.unassigned', 'task.waiting_human', 'task.start_reached')
        ), t as (
          select t.* from tasks t join statuses s on s.id = t.status_id
          where t.archived_at is null and s.category not in ('done', 'cancelled')
            and t.project_id in (select project_id from r)
        )
        select r.id as "ruleId", t.id as "taskId", x.slot from r join t on t.project_id = r.project_id
        cross join lateral (select case r.trigger->>'type'
          when 'task.stale' then (
            select t.updated_at::text
            where t.updated_at <= ${at}::timestamptz - make_interval(days => (r.trigger->>'days')::int)
              and (coalesce(jsonb_array_length(r.trigger->'statuses'), 0) = 0
                or r.trigger->'statuses' ? t.status_id::text))
          when 'task.unassigned' then (
            select u.since::text from (select greatest(t.created_at, (select max(a.created_at)
              from activity a where a.task_id = t.id and a.kind = 'assignee_removed')) as since) u
            where u.since <= ${at}::timestamptz - make_interval(hours => (r.trigger->>'hours')::int)
              and not exists (select 1 from task_assignees ta where ta.task_id = t.id))
          when 'task.waiting_human' then (
            select c.id::text from comments c
            join users u on u.id = c.assignee_id and u.deactivated_at is null and not u.bot
            where c.task_id = t.id and c.resolved_at is null
              and c.created_at <= ${at}::timestamptz - make_interval(days => (r.trigger->>'days')::int)
            order by c.created_at limit 1)
          when 'task.start_reached' then (
            select t.start_date::text where t.start_date <= ${day}::date)
        end as slot) x
        where x.slot is not null`,
  );
  for (const f of found)
    await fire(api, f.ruleId as string, f.taskId as string, f.slot as string, now);
}

/** Every minute: rules whose cron came due in the last 2 minutes (in tz or settings.timezone) — runs over open tasks. */
async function schedule(data: { now?: string }, api: JobApi) {
  const now = data.now ? new Date(data.now) : new Date();
  const rules = await rows(
    api,
    sql`select r.id, r.project_id as "projectId", r.trigger from automations_rules r
        join projects p on p.id = r.project_id and 'automations' = any(p.modules)
        where r.enabled and r.trigger->>'type' = 'schedule'`,
  );
  let tz: string | undefined;
  for (const r of rules) {
    const t = r.trigger as { cron: string; tz?: string };
    let due: Date;
    try {
      due = CronExpressionParser.parse(t.cron, {
        currentDate: now,
        tz: t.tz ?? (tz ??= await instanceTz(api)),
      })
        .prev()
        .toDate();
    } catch {
      continue; // out-of-range field passed the shape check — the rule never fires
    }
    if (now.getTime() - due.getTime() > 120_000) continue;
    const tasks = await rows(
      api,
      sql`select t.id from tasks t join statuses s on s.id = t.status_id
          where t.project_id = ${r.projectId as string} and t.archived_at is null
            and s.category not in ('done', 'cancelled')`,
    );
    for (const k of tasks) await fire(api, r.id as string, k.id as string, due.toISOString(), now);
  }
}

/** Once a day: the run log is kept for 30 days; fired marks — while the rule and task live, schedule ones 30 days. */
async function cleanup(data: { now?: string }, api: JobApi) {
  const now = data.now ? new Date(data.now) : new Date();
  const old = sql`${now.toISOString()}::timestamptz - interval '30 days'`;
  await api.db.execute(sql`delete from automations_runs where created_at < ${old}`);
  await api.db.execute(
    sql`delete from automations_fired f where
          not exists (select 1 from automations_rules r where r.id = f.rule_id)
          or not exists (select 1 from tasks t where t.id = f.task_id)
          or (f.created_at < ${old} and exists (select 1 from automations_rules r
            where r.id = f.rule_id and r.trigger->>'type' = 'schedule'))`,
  );
}

const jobs = [
  { queue: RUN_QUEUE, retryLimit: 0, handler: run },
  { queue: 'automations.due', cron: '0 * * * *', handler: due },
  { queue: 'automations.schedule', cron: '* * * * *', handler: schedule },
  { queue: 'automations.cleanup', cron: '0 3 * * *', handler: cleanup },
] as unknown as JobDef[];

@Controller('api/automations')
class AutomationsController {
  constructor(@Inject(CORE) private core: CoreServices) {}

  @Get('rules/:id/runs')
  async runs(@Req() req: object, @Param('id') ruleId: string, @Query('limit') limit?: string) {
    const { userId } = this.core.auth(req);
    const n = limit === undefined ? 50 : Number(limit);
    if (!Number.isInteger(n) || n < 1 || n > 200)
      throw new HttpError(400, 'invalid_request', 'limit: 1–200');
    const notFound = new HttpError(404, 'not_found', 'Правило не найдено');
    if (!UUID.test(ruleId)) throw notFound;
    const q = (s: ReturnType<typeof sql>) => this.core.db.execute(s).then((r) => r.rows as Row[]);
    const visible = await q(
      sql`select r.project_id as "projectId" from automations_rules r join space_members m on m.space_id = r.space_id
          where r.id = ${ruleId} and m.user_id = ${userId}`,
    );
    if (!visible.length) throw notFound;
    // C-schema v16: the module is off in the rule's project
    const on = await q(
      sql`select 'automations' = any(modules) as on from projects where id = ${visible[0]!.projectId as string}::uuid`,
    );
    if (on[0] && !on[0].on)
      throw new HttpError(404, 'module_disabled', 'Модуль automations выключен в проекте');
    const data = await q(
      sql`select id, rule_id as "ruleId", task_id as "taskId", depth, status, error,
          created_at as "createdAt" from automations_runs
          where rule_id = ${ruleId} order by created_at desc, id desc limit ${n}`,
    );
    return { data };
  }
}

@Injectable()
class AutomationsBoot {
  constructor(@Inject(CORE) c: CoreServices) {
    core = c;
  }
}

@Module({ controllers: [AutomationsController], providers: [AutomationsBoot] })
class AutomationsModule {}

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: AutomationsModule,
  mutators: shared.mutators,
  entities: shared.entities,
  afterMutation: afterMutation as BackendModuleManifest['afterMutation'],
  jobs,
};
