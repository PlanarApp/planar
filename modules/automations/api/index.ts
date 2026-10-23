import { Controller, Get, Inject, Module, Param, Query, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  CORE,
  HttpError,
  type CoreServices,
  type JobApi,
  type JobDef,
  type ModuleHookApi,
} from '@planar/server-kit';
import {
  matchFilter,
  resolveDate,
  textToDoc,
  uuidv7,
  type AfterMutationCtx,
  type BackendModuleManifest,
  type Filter,
  type FilterCtx,
  type FilterTask,
  type MutationWrite,
} from '@planar/shared';
import { shared, type Action, type Rule, type Trigger } from '../shared/index.js';

const MAX_DEPTH = 3;
const RUN_QUEUE = 'automations.run';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RunData {
  ruleId: string;
  taskId: string;
  depth: number;
  eventAt: string;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
type Row = Record<string, unknown>;

/** События по записям мутации: задача, тип триггера, детали для сверки с параметрами триггера. */
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

async function afterMutation(writes: MutationWrite[], ctx: AfterMutationCtx, api: ModuleHookApi) {
  const depth = (ctx.origin?.depth ?? 0) + 1;
  if (depth > MAX_DEPTH) return;
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
    if (!projectId) continue; // задача удалена
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
      // правило не срабатывает на собственное действие
      if (!r.enabled || r.id === ctx.origin?.ruleId || queued.has(key) || !e.match(r.trigger))
        continue;
      queued.add(key);
      await api.enqueue(RUN_QUEUE, { ruleId: r.id, taskId: e.taskId, depth, eventAt: ctx.now });
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
    /* неверный пояс — UTC */
  }
  return 'UTC';
}
const todayIn = (timeZone: string, now: Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);

async function today(api: JobApi, now = new Date()) {
  const [s] = await rows(api, sql`select value from settings where id = 'timezone'`);
  return todayIn(tzOrUtc(s?.value), now);
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
            // shortcut: хвост 'V' даёт ранг после последнего, цепочка растёт; перебалансировка — при rankBetween в клиенте
            rank: last?.r ? `${last.r as string}V` : 'a0',
          },
        });
        break;
      }
    }
  }
  return muts;
}

async function run(d: RunData, api: JobApi) {
  const [r] = await rows(
    api,
    sql`select id, enabled, conditions, actions, project_id as "projectId" from automations_rules where id = ${d.ruleId}`,
  );
  const task = r?.enabled ? await loadTask(api, d.taskId) : undefined;
  if (!r || !task) return void (await record(api, d, 'skipped'));
  const rule = r as unknown as Rule;
  const statuses = (await rows(
    api,
    sql`select id, space_id as "spaceId", category, rank from statuses where space_id = ${(task as unknown as Row).spaceId as string} order by rank`,
  )) as unknown as Status[];
  const fieldDefs = await rows(
    api,
    sql`select id, project_id as "projectId", type from field_defs where project_id = ${task.projectId}`,
  );
  const ctx: FilterCtx = {
    statuses: statuses as never,
    fieldDefs: fieldDefs as never,
    userId: api.systemUserId,
    today: await today(api),
  };
  if (!matchFilter(task, rule.conditions as Filter, ctx))
    return void (await record(api, d, 'skipped'));
  try {
    const muts = await toMutations(api, rule, task, statuses);
    await api.execute(api.systemUserId, muts, {
      system: true,
      origin: { ruleId: d.ruleId, depth: d.depth },
    });
  } catch (e) {
    return void (await record(api, d, 'error', e instanceof Error ? e.message : String(e)));
  }
  await record(api, d, 'ok');
}

/** Один раз на (правило, задача, dueDate): запись в automations_due_fired до постановки. */
async function due(data: { now?: string }, api: JobApi) {
  const now = data.now ? new Date(data.now) : new Date();
  const day = await today(api, now);
  const rules = await rows(
    api,
    sql`select id, project_id as "projectId", trigger from automations_rules
        where enabled and trigger->>'type' = 'task.due'`,
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
}

/** Раз в сутки: журнал запусков хранится 30 дней. */
async function cleanup(data: { now?: string }, api: JobApi) {
  const now = data.now ? new Date(data.now) : new Date();
  await api.db.execute(
    sql`delete from automations_runs where created_at < ${now.toISOString()}::timestamptz - interval '30 days'`,
  );
}

const jobs = [
  { queue: RUN_QUEUE, retryLimit: 0, handler: run },
  { queue: 'automations.due', cron: '0 * * * *', handler: due },
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
      sql`select 1 from automations_rules r join space_members m on m.space_id = r.space_id
          where r.id = ${ruleId} and m.user_id = ${userId}`,
    );
    if (!visible.length) throw notFound;
    const data = await q(
      sql`select id, rule_id as "ruleId", task_id as "taskId", depth, status, error,
          created_at as "createdAt" from automations_runs
          where rule_id = ${ruleId} order by created_at desc, id desc limit ${n}`,
    );
    return { data };
  }
}

@Module({ controllers: [AutomationsController] })
class AutomationsModule {}

export const api: BackendModuleManifest = {
  id: shared.id,
  nestModule: AutomationsModule,
  mutators: shared.mutators,
  entities: shared.entities,
  afterMutation: afterMutation as BackendModuleManifest['afterMutation'],
  jobs,
};
