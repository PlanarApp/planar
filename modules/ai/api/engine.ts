// PLNRAPP-404: the engine — the system accepts a run's result by the action's checks instead of the AI's own word,
// sends it back for rework, restarts lost runs and picks up the tasks that stand in a status of an action.
// PLNRAPP-405: a parent task coordinates its subtasks on the AI — waits for them, wakes up on their outcomes.
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { JobApi, Q } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import { matched } from '@planar/module-automations/api';
import { resolveConnection, secretOf } from './connections.js';
import { generateStructured } from './llm.js';
import type { Tracker } from './monitor.js';
import type { RunReport } from './schema.js';
import {
  aiEnabled,
  botOf,
  CRITERIA_HEADING,
  enqueueRun,
  failed,
  keyOf,
  type AiResult,
  type contextOf,
  type Run,
  type TaskRunData,
} from './run.js';

type Row = Record<string, unknown>;
type Enqueue = Parameters<typeof enqueueRun>[1];
const one = async (q: Pick<Q, 'execute'>, s: ReturnType<typeof sql>) =>
  (await q.execute(s)).rows[0] as Row | undefined;

/** «$ command» — an executable check: the agent's container runs it, exit code 0 passes */
export const isCommand = (c: string) => c.startsWith('$ ');

/** PLNRAPP-405: the list items of the section «Критерии приёмки» of a description (markdown), up to the next heading */
export function criteriaOf(markdown: string): string[] {
  const lines = markdown.split('\n');
  const at = lines.findIndex(
    (l) => /^#{1,6}\s/.test(l) && l.replace(/^#+/, '').trim() === CRITERIA_HEADING,
  );
  if (at < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(at + 1)) {
    if (/^#{1,6}\s/.test(l)) break;
    const m = /^\s*[-*]\s+(.+)$/.exec(l);
    if (m) out.push(m[1]!.trim().slice(0, 500));
  }
  return out.slice(0, 20);
}

/** An open task blocks `task` (a link «блокирует» from a task not done / cancelled) */
export const openBlocker = (task: SQL) =>
  sql`exists (select 1 from task_links k join tasks b on b.id = k.task_id join statuses bs on bs.id = b.status_id
      where k.target_id = ${task} and k.kind = 'blocks' and b.archived_at is null
        and bs.category not in ('done', 'cancelled'))`;

/** Subtasks of the AI not finished: open, and no action run yet or the last one queued / at work / waiting */
export async function pendingSubtasks(q: Pick<Q, 'execute'>, taskId: string, bot: string) {
  const r = await one(
    q,
    sql`select count(*)::int as n from tasks s join statuses st on st.id = s.status_id
          join task_assignees a on a.task_id = s.id and a.user_id = ${bot}
          left join lateral (select state from ai_runs where task_id = s.id and kind = 'action'
            order by created_at desc, id desc limit 1) l on true
        where s.parent_id = ${taskId} and s.archived_at is null and st.category not in ('done', 'cancelled')
          and (l.state is null or l.state in ('queued', 'running', 'waiting_human', 'waiting_subtasks'))`,
  );
  return (r?.n as number | undefined) ?? 0;
}

/** Subtasks of a waiting parent run one after another: at most max_agents of the project (default 1) at a time */
export async function siblingsFull(
  q: Pick<Q, 'execute'>,
  t: { id: string; parentId: string | null; projectId: string },
) {
  if (!t.parentId) return false;
  const r = await one(
    q,
    sql`select exists (select 1 from ai_runs where task_id = ${t.parentId} and state = 'waiting_subtasks') as w,
          (select count(*)::int from ai_runs r join tasks s on s.id = r.task_id
            where s.parent_id = ${t.parentId} and s.id <> ${t.id} and r.kind = 'action' and r.state = 'running') as n,
          (select max_agents from ai_project_limits where project_id = ${t.projectId}) as m`,
  );
  return !!r?.w && (r.n as number) >= ((r.m as number | null) ?? 1);
}

/**
 * The outcome of a subtask's action run (accepted, a question, failed): the parent's run waiting for its subtasks
 * is done, its action runs again with the event; the reconcile starts the next wave of the subtasks at once.
 * shortcut: an outcome while the parent's next run is at work does not wake it again — it sees the subtask's state
 * in its context; a lost event needs a person's restart (a queue of events if that shows up).
 */
export async function wakeParent(q: Pick<Q, 'execute'>, enqueue: Enqueue, run: Run) {
  if (run.kind !== 'action' || !run.task.parentId) return;
  const p = await one(
    q,
    sql`update ai_runs set state = 'done', updated_at = now()
        where id = (select id from ai_runs where task_id = ${run.task.parentId} and state = 'waiting_subtasks'
          order by created_at desc limit 1) and state = 'waiting_subtasks'
        returning action_id as "actionId", rule_id as "ruleId"`,
  );
  if (!p?.actionId) return;
  const d: TaskRunData = {
    kind: 'action',
    taskId: run.task.parentId,
    actionId: p.actionId as string,
    ruleId: (p.ruleId as string | null) ?? null,
    wokenBy: run.id,
  };
  await enqueueRun(q, enqueue, d, { singletonKey: keyOf(d), upsert: true });
  await enqueue(RECONCILE_QUEUE, { trigger: 'event' }, { singletonKey: RECONCILE_QUEUE });
}

/** For the prompt of a parent woken by a subtask: what happened; '' — not woken. */
export async function wokenBlock(q: Pick<Q, 'execute'>, runId: string | null | undefined) {
  if (!runId) return '';
  const s = await one(
    q,
    sql`select p.key || '-' || t.number as key, t.title, r.state, r.report from ai_runs r
        join tasks t on t.id = r.task_id join projects p on p.id = t.project_id where r.id = ${runId}`,
  );
  if (!s) return '';
  const what =
    s.state === 'done'
      ? 'принята'
      : s.state === 'waiting_human'
        ? 'ждёт ответа человека на вопрос'
        : 'не выполнена (ошибка или исчерпаны попытки)';
  const failures = (s.report as RunReport | null)?.failures ?? [];
  return `\n\n# Событие подзадачи
${s.key as string} «${s.title as string}» — ${what}.${failures.length ? `\nЗамечания проверки:\n${failures.map((f) => `- ${f}`).join('\n')}` : ''}
Реши по подзадачам: следующая волна (newTasks с ai), доработка (subtasks[].moveTo), вопрос человеку (question) или итог (done, когда работа готова).`;
}

export const maxAttemptsOf = (a?: { maxAttempts?: number | null }) => {
  const n = Number(process.env.AI_MAX_ATTEMPTS);
  return a?.maxAttempts ?? (Number.isInteger(n) && n > 0 ? n : 3);
};

/** What the agent's container reports for each «$» check (docker/ai-agent/entrypoint.sh). */
export const checkResultsSchema = z
  .array(z.object({ check: z.string().max(500), ok: z.boolean(), output: z.string().max(8000) }))
  .max(20);
export type CheckedResult = AiResult & { checkResults?: z.infer<typeof checkResultsSchema> };

const verdictSchema = z.object({
  pass: z.boolean(),
  failures: z.array(z.string().max(2000)).max(20),
});

const JUDGE = `Ты — проверяющий в трекере задач Planar. Тебе дают задачу, критерии готовности и результат исполнителя-ИИ.
Проверь каждый критерий по фактам результата и контекста задачи; самооценке исполнителя не верь. Сомнения исполнителя (uncertain) проверь отдельно.
pass — true, только если выполнены все критерии и сомнения не указывают на ошибку. failures — по пункту на каждый невыполненный критерий или подтверждённое сомнение: что не так и что сделать; при pass — пустой список. Пиши на языке задачи.`;

const note = (q: Pick<Q, 'execute'>, id: string, line: string) =>
  q.execute(sql`update ai_runs set log = log || ${`движок: ${line}\n`} where id = ${id}`);

/**
 * The remarks of the acceptance; [] — accepted. A provider error of the LLM check accepts (it says nothing of the work).
 * `force` — the LLM review even without criteria and doubts (PLNRAPP-405: a risky result).
 */
async function accept(
  api: JobApi,
  run: Run,
  r: CheckedResult,
  ctx: Awaited<ReturnType<typeof contextOf>>,
  force: boolean,
): Promise<string[]> {
  const checks = run.action?.checks ?? [];
  const failures: string[] = [];
  const commands = checks.filter(isCommand);
  if (commands.length && !r.checkResults)
    await note(api.db, run.id, 'команды проверок пропущены — запуск без контейнера агента');
  else
    for (const c of commands) {
      const got = r.checkResults!.find((x) => x.check === c);
      if (!got) failures.push(`${c} — не выполнена`);
      else if (!got.ok) failures.push(`${c} — завершилась с ошибкой:\n${got.output.slice(-2000)}`);
    }
  const criteria = checks.filter((c) => !isCommand(c));
  if (!criteria.length && !r.uncertain && !force) return failures;
  const conn = await resolveConnection(api.db, run.task.projectId);
  if (!conn) {
    await note(api.db, run.id, 'проверка критериев пропущена — нет подключения к ИИ');
    return failures;
  }
  const result = {
    comment: r.comment,
    uncertain: r.uncertain,
    descriptionAppend: r.descriptionAppend,
    moveTo: r.moveTo,
    labels: r.labels,
    fields: r.fields,
    newTasks: r.newTasks,
    subtasks: r.subtasks,
    checkResults: r.checkResults,
  };
  try {
    const c = secretOf(conn);
    const { object, usage } = await generateStructured(
      { ...c, model: run.action?.model ?? c.model },
      {
        schema: verdictSchema,
        system: JUDGE,
        prompt: `${ctx.text}\n\n# Критерии готовности\n${
          criteria.map((x) => `- ${x}`).join('\n') ||
          (force
            ? '— (проверь, что результат выполняет задачу по её описанию, и сомнения)'
            : '— (проверь только сомнения)')
        }\n\n# Результат исполнителя (JSON)\n${JSON.stringify(result, null, 1)}`,
      },
    );
    await api.db.execute(
      sql`update ai_runs set input_tokens = input_tokens + ${usage.inputTokens},
          output_tokens = output_tokens + ${usage.outputTokens},
          cost = case when ${usage.cost}::float8 is null then cost else coalesce(cost, 0) + ${usage.cost}::float8 end
          where id = ${run.id}`,
    );
    if (!object.pass)
      failures.push(...(object.failures.length ? object.failures : ['критерии не выполнены']));
  } catch (e) {
    await note(
      api.db,
      run.id,
      `проверка критериев не выполнена (${e instanceof Error ? e.name : 'error'}) — принято без неё`,
    );
  }
  return failures;
}

/** The job of the same work again: the same action / comment / checklist, as a restart of `run`. */
function againOf(run: Run, ruleId: string | null): TaskRunData {
  const base = { taskId: run.task.id, restartOf: run.id };
  if (run.kind === 'action') return { kind: 'action', ...base, actionId: run.action!.id, ruleId };
  if (run.kind === 'checklist') return { kind: 'checklist', ...base };
  return { kind: run.kind as 'comment' | 'mention', ...base, itemId: run.item!.id as string };
}

/**
 * Another attempt of the run's work: the run is failed (with the report the next prompt reads), the next one is
 * queued with attempt + 1, after `pause` × attempt seconds. false — the attempts are spent (or not a task run).
 */
export async function rework(
  api: JobApi,
  run: Run,
  why: string,
  report: RunReport | null,
  pause = 0,
): Promise<boolean> {
  if (!['action', 'comment', 'mention', 'checklist'].includes(run.kind)) return false;
  const row = await one(
    api.db,
    sql`select attempt, rule_id as "ruleId" from ai_runs where id = ${run.id}`,
  );
  const attempt = (row?.attempt as number | undefined) ?? 1;
  const max = maxAttemptsOf(run.action);
  if (attempt >= max) return false;
  const taken = await one(
    api.db,
    sql`update ai_runs set state = 'failed', report = ${report ? JSON.stringify(report) : null}::jsonb,
        log = log || ${[...run.log, `движок: ${why} — попытка ${attempt + 1} из ${max}`].map((l) => `${l}\n`).join('')},
        updated_at = now() where id = ${run.id} and state = 'running' returning id`,
  );
  // stopped / replaced meanwhile: nothing to repeat
  if (!taken) return true;
  const d = againOf(run, (row?.ruleId as string | null) ?? null);
  await enqueueRun(
    api.db,
    api.enqueue,
    d,
    { singletonKey: keyOf(d), upsert: true, ...(pause && { startAfter: pause * attempt }) },
    attempt + 1,
  );
  return true;
}

/**
 * A `done` result through the acceptance. true — handled here (sent for rework, or the question to a person once
 * the attempts are spent: `ask` applies it); false — accepted, apply goes on.
 */
export async function review(
  api: JobApi,
  run: Run,
  r: CheckedResult,
  ctx: Awaited<ReturnType<typeof contextOf>>,
  ask: (r: AiResult) => Promise<void>,
): Promise<boolean> {
  // PLNRAPP-405: a risky result — the action asks for the review, or a subtask's work came back for rework
  const attempt = ((await one(api.db, sql`select attempt from ai_runs where id = ${run.id}`))
    ?.attempt ?? 1) as number;
  const force = !!run.action?.review || (!!run.task.parentId && attempt > 1);
  if (!run.action?.checks.length && !r.uncertain && !force) return false;
  if (force) run.log.push('движок: ревью свежим контекстом');
  const failures = await accept(api, run, r, ctx, force);
  if (!failures.length) {
    if (run.action?.checks.length || force) run.log.push('движок: результат принят проверками');
    return false;
  }
  const report: RunReport = { failures, comment: r.comment, uncertain: r.uncertain };
  if (await rework(api, run, 'результат не принят проверками', report)) return true;
  await api.db.execute(
    sql`update ai_runs set report = ${JSON.stringify(report)}::jsonb where id = ${run.id}`,
  );
  run.log.push('движок: попытки исчерпаны — вопрос человеку');
  await ask({
    ...failed(''),
    verdict: 'question',
    comment: `Результат не принят проверками после ${maxAttemptsOf(run.action)} попыток. Последний итог ИИ:\n\n${r.comment}\n\nЧто не прошло:`,
    questions: failures.slice(0, 10).map((f) => f.slice(0, 2000)),
  });
  return true;
}

/** For the prompt of a rework: what the previous attempt failed on; '' — not a rework. */
export async function reworkBlock(
  q: Pick<Q, 'execute'>,
  runId: string,
  restartOf: string | null | undefined,
  max: number,
) {
  if (!restartOf) return '';
  const p = await one(q, sql`select report from ai_runs where id = ${restartOf}`);
  const report = p?.report as RunReport | null | undefined;
  if (!report?.failures.length) return '';
  const me = await one(q, sql`select attempt from ai_runs where id = ${runId}`);
  return `\n\n# Доработка: попытка ${(me?.attempt as number | undefined) ?? 1} из ${max}
Прошлый результат не принят проверками:
${report.failures.map((f) => `- ${f}`).join('\n')}${report.comment ? `\n\nПрошлый итог:\n${report.comment}` : ''}`;
}

export const RECONCILE_QUEUE = 'ai.engine.reconcile';

/**
 * Cron: a task on the AI in a status where an enabled rule (`task.status_changed` → `to`) runs an action, matching the
 * rule's conditions, whose last run of the action is missing or failed with attempts left (after a pause) → queued.
 * A done or cancelled run is left alone until the task enters the status again after it (PLNRAPP-656: the test sent
 * the task back after the dev run) — then attempt 1 anew; an active run is left alone, a task with an open blocker waits, and so
 * does a task with an active run of any action (PLNRAPP-537: the plan does not start while triage waits for answers).
 * PLNRAPP-500: a pass of the engine «task control» (engines.ts); `projectId` — only the project (a manual pass).
 */
export async function reconcilePass(api: JobApi, t: Tracker, projectId: string | null = null) {
  if (!(await aiEnabled(api.db))) return void (await t.step('сверка: ИИ выключен — пропуск'));
  const bot = await botOf(api);
  if (!bot) return void (await t.step('сверка: нет бота ИИ — пропуск'));
  await t.check();
  const found = (
    await api.db.execute(
      sql`select x.rule_id as "ruleId", x.action_id as "actionId", t.id as "taskId", t.status_id as "statusId",
            t.project_id as "projectId", p.key || '-' || t.number as key,
            l.id as "lastId", l.state, l.attempt, a.max_attempts as "maxAttempts",
            l.finished_at < now() - make_interval(secs => 60 * l.attempt) as "paused",
            coalesce(l.state in ('done', 'cancelled') and e.at > l.finished_at, false) as reentered
          from (select r.id as rule_id, r.project_id, r.trigger, (e->>'aiActionId')::uuid as action_id
                from automations_rules r cross join lateral jsonb_array_elements(r.actions) e
                where r.enabled and r.trigger->>'type' = 'task.status_changed' and e->>'type' = 'ai_run'
                  ${projectId ? sql`and r.project_id = ${projectId}::uuid` : sql``}) x
          join projects p on p.id = x.project_id and 'ai' = any(p.modules) and 'automations' = any(p.modules)
          join ai_actions a on a.id = x.action_id and a.project_id = x.project_id
          join tasks t on t.project_id = x.project_id and t.archived_at is null
            and x.trigger->'to' ? t.status_id::text
          join task_assignees ta on ta.task_id = t.id and ta.user_id = ${bot}
          left join lateral (select id, state, attempt, finished_at from ai_runs
            where task_id = t.id and action_id = x.action_id order by created_at desc limit 1) l on true
          -- the last entry into the current status
          left join lateral (select max(created_at) as at from activity
            where task_id = t.id and kind = 'updated' and changes->'statusId'->>1 = t.status_id::text) e on true
          where (l.id is null or l.state = 'failed' or (l.state in ('done', 'cancelled') and e.at > l.finished_at))
            and not ${openBlocker(sql`t.id`)}
            and not exists (select 1 from ai_runs o where o.task_id = t.id
              and o.state in ('queued', 'running', 'waiting_human', 'waiting_subtasks'))
          limit 200`,
    )
  ).rows as {
    ruleId: string;
    actionId: string;
    taskId: string;
    statusId: string;
    projectId: string;
    key: string;
    lastId: string | null;
    attempt: number | null;
    maxAttempts: number | null;
    paused: boolean | null;
    reentered: boolean;
  }[];
  for (const f of found) {
    if (f.lastId && !f.reentered && (!f.paused || f.attempt! >= maxAttemptsOf(f))) continue;
    await t.check();
    if (!(await matched(api, f.ruleId, f.taskId))) continue;
    const runId = uuidv7();
    const retry = f.lastId && !f.reentered;
    const d = {
      kind: 'action' as const,
      taskId: f.taskId,
      actionId: f.actionId,
      ruleId: f.ruleId,
      statusId: f.statusId,
      restartOf: retry ? f.lastId : null,
      runId,
    };
    const attempt = retry ? f.attempt! + 1 : 1;
    await enqueueRun(api.db, api.enqueue, d, { singletonKey: keyOf(d), upsert: true }, attempt);
    const why = retry
      ? 'повтор упавшего запуска'
      : f.reentered
        ? 'задача снова в статусе действия'
        : 'задача стоит в статусе действия';
    await note(api.db, runId, `сверка: ${why}`);
    t.count();
    await t.step(`сверка: ${f.key} — ${why}, ИИ запущен (попытка ${attempt})`, {
      projectId: f.projectId,
      taskId: f.taskId,
      level: 'action',
    });
  }
  await waitingPass(api, t, projectId);
  await ciPass(api, t, projectId);
}

/** PLNRAPP-656: runs queued over 15 min (no free agent container or the subtask siblings are busy) — into the log. */
async function waitingPass(api: JobApi, t: Tracker, projectId: string | null) {
  const waiting = (
    await api.db.execute(
      sql`select r.project_id as "projectId", r.task_id as "taskId", p.key || '-' || tk.number as key,
            floor(extract(epoch from now() - r.created_at) / 60)::int as min
          from ai_runs r join tasks tk on tk.id = r.task_id join projects p on p.id = tk.project_id
          where r.state = 'queued' and r.created_at < now() - interval '15 minutes'
            ${projectId ? sql`and r.project_id = ${projectId}::uuid` : sql``}
          order by r.created_at limit 20`,
    )
  ).rows as { projectId: string; taskId: string; key: string; min: number }[];
  for (const w of waiting)
    await t.step(
      `сверка: ${w.key} — ждёт запуска ${w.min} мин (заняты контейнеры агента или подзадачи-соседи)`,
      { projectId: w.projectId, taskId: w.taskId },
    );
}

/**
 * The CI part of the task control: the AI runs a rule `mr.pipeline` (a failed pipeline of the task's MR → the AI
 * fixes it) started since the previous pass — into the monitor's log. The rule itself runs from the GitLab poll.
 */
async function ciPass(api: JobApi, t: Tracker, projectId: string | null) {
  const runs = (
    await api.db.execute(
      sql`select r.id, r.task_id as "taskId", r.project_id as "projectId", r.state,
            p.key || '-' || tk.number as key
          from ai_runs r join automations_rules ar on ar.id = r.rule_id
            join tasks tk on tk.id = r.task_id join projects p on p.id = tk.project_id
          where ar.trigger->>'type' = 'mr.pipeline'
            -- (the previous pass's start; this pass's start]: passes see each run once
            and r.created_at <= (select started_at from ai_engine_runs where id = ${t.id})
            and r.created_at > coalesce((select max(started_at) from ai_engine_runs
              where engine = 'tasks' and job in ('reconcile', 'manual') and project_id is null and id <> ${t.id}
                and started_at < (select started_at from ai_engine_runs where id = ${t.id})),
              now() - interval '5 minutes')
            ${projectId ? sql`and r.project_id = ${projectId}::uuid` : sql``}
          order by r.created_at limit 100`,
    )
  ).rows as { taskId: string; projectId: string; key: string; state: string }[];
  for (const r of runs) {
    t.count();
    await t.step(`CI: ${r.key} — ИИ запущен по конвейеру MR (прогон: ${r.state})`, {
      projectId: r.projectId,
      taskId: r.taskId,
      level: 'action',
    });
  }
}
