// PLNRAPP-404: the engine — the system accepts a run's result by the action's checks instead of the AI's own word,
// sends it back for rework, restarts lost runs and picks up the tasks that stand in a status of an action.
// PLNRAPP-405: a parent task coordinates its subtasks on the AI — waits for them, wakes up on their outcomes.
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { JobApi, Q } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import { applyRule, matched } from '@planar/module-automations/api';
import { resolveConnection, secretOf } from './connections.js';
import { generateStructured } from './llm.js';
import type { Tracker } from './monitor.js';
import { retroPass } from './retro.js';
import type { RunReport } from './schema.js';
import { AI_BOT_LOGIN } from '../shared/index.js';
import {
  AI_QUEUE,
  aiEnabled,
  asDoc,
  botOf,
  CRITERIA_HEADING,
  enqueueRun,
  failed,
  humanOf,
  keyOf,
  withMention,
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

/**
 * PLNRAPP-776: `task` has an open subtask — it coordinates them: rules and the reconcile start no action on it
 * (its run waiting for the subtasks is woken by their outcomes), the watchdog leaves it alone (PLNRAPP-740)
 */
export const openSubtasks = (task: SQL) =>
  sql`exists (select 1 from tasks c join statuses cs on cs.id = c.status_id
      where c.parent_id = ${task} and c.archived_at is null and cs.category not in ('done', 'cancelled'))`;

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
 * PLNRAPP-776: a task with open subtasks coordinates them — no action starts on it.
 * PLNRAPP-500: a pass of the engine «task control» (engines.ts); `projectId` — only the project (a manual pass).
 */
export async function reconcilePass(api: JobApi, t: Tracker, projectId: string | null = null) {
  if (!(await aiEnabled(api.db))) return void (await t.step('сверка: ИИ выключен — пропуск'));
  const bot = await botOf(api);
  if (!bot) return void (await t.step('сверка: нет бота ИИ — пропуск'));
  await t.check();
  // first: a restart it queues is an active run the search below leaves alone; answered before lost (PLNRAPP-773)
  await answeredPass(api, t, projectId);
  await lostQuestionsPass(api, t, bot, projectId);
  const found = (
    await api.db.execute(
      sql`select x.rule_id as "ruleId", x.action_id as "actionId", t.id as "taskId", t.status_id as "statusId",
            t.project_id as "projectId", t.space_id as "spaceId", t.created_by as "createdBy",
            t.parent_id as "parentId", p.key || '-' || t.number as key,
            l.id as "lastId", l.state, l.attempt, a.max_attempts as "maxAttempts",
            l.report->>'lostQuestion' as lost, coalesce((l.report->>'stopped')::boolean, false) as stopped,
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
          left join lateral (select id, state, attempt, finished_at, report from ai_runs
            where task_id = t.id and action_id = x.action_id order by created_at desc limit 1) l on true
          -- the last entry into the current status
          left join lateral (select max(created_at) as at from activity
            where task_id = t.id and kind = 'updated' and changes->'statusId'->>1 = t.status_id::text) e on true
          where (l.id is null or l.state = 'failed' or (l.state in ('done', 'cancelled') and e.at > l.finished_at))
            and not ${openBlocker(sql`t.id`)}
            and not ${openSubtasks(sql`t.id`)}
            -- PLNRAPP-679: «harness-retro» and its items are the retro's, not actions'
            and not exists (select 1 from ai_retro rt where rt.task_id in (t.id, t.parent_id))
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
    spaceId: string;
    createdBy: string;
    parentId: string | null;
    key: string;
    lastId: string | null;
    state: string | null;
    lost: string | null;
    stopped: boolean;
    attempt: number | null;
    maxAttempts: number | null;
    paused: boolean | null;
    reentered: boolean;
  }[];
  for (const f of found) {
    // PLNRAPP-741: a question that never got into the task, the attempts spent — stopped with the reason, once
    if (f.lastId && !f.reentered && f.attempt! >= maxAttemptsOf(f)) {
      if (f.state === 'failed' && f.lost && !f.stopped)
        await stopLost(
          api,
          t,
          bot,
          { ...f, id: f.lastId, attempt: f.attempt! },
          f.lost,
          maxAttemptsOf(f),
        );
      continue;
    }
    if (f.lastId && !f.reentered && !f.paused) continue;
    await t.check();
    const m = await matched(api, f.ruleId, f.taskId);
    // the task moved on since the search (another rule of the status already took it) — the next pass sees it anew
    if (!m || m.task.statusId !== f.statusId) continue;
    const runId = uuidv7();
    const retry = f.lastId && !f.reentered;
    // PLNRAPP-837: an entry into the status — the rule's other actions first (set_status → «В работе», labels, …), as on
    // its trigger; a retry of a failed run does not repeat them. The run goes only while the task stays in the status
    // after them.
    let statusId: string = f.statusId;
    if (!retry) {
      try {
        await applyRule(api, m);
      } catch (e) {
        await t.step(
          `сверка: ${f.key} — действия правила не выполнены: ${e instanceof Error ? e.message : String(e)}`,
          { projectId: f.projectId, taskId: f.taskId, level: 'error' },
        );
        continue;
      }
      const now = await one(api.db, sql`select status_id as s from tasks where id = ${f.taskId}`);
      if (!now) continue;
      statusId = now.s as string;
    }
    const d = {
      kind: 'action' as const,
      taskId: f.taskId,
      actionId: f.actionId,
      ruleId: f.ruleId,
      statusId,
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
  await retroPass(api, t, projectId);
  await waitingPass(api, t, projectId);
  await unstickPass(api, t, projectId);
  await watchPass(api, t, bot, projectId);
  await ciPass(api, t, projectId);
}

const envInt = (name: string, def: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : def;
};
/** PLNRAPP-657: the first words of the watchdog's comments — at most two per entry into the status (PLNRAPP-740) */
const WATCH_MARK = 'Сторож движка ИИ';
/** PLNRAPP-773: the words of the watchdog's question to a person — the second and last comment in the status */
const ASK_MARK = 'Нужно решение человека';

/**
 * PLNRAPP-657: tasks left on the AI — the AI among the assignees, a todo / in_progress status, no active run and no
 * activity for AI_STALL_MIN (60). Not the statuses where a wait is expected: the question status of an action (the
 * answer) and a status an externally triggered rule waits in (e.g. «Test prod» — the merge and the deploy).
 * PLNRAPP-754: a backlog status too, if a rule runs the AI on entering it (the plan in «Бэклог» moves the task on to
 * «К работе»): a task left there — the plan failed its attempts or ended without a move — is stuck as well. Not the
 * task «harness-retro» and its items: the bot's own bookkeeping lives in the backlog.
 * PLNRAPP-740: not a task that waits for other work — an open blocker, an open subtask, its MR's pipeline at work.
 * PLNRAPP-773: the question status counts only while a person has an open question there; `handed` — the stall went
 * to the AI (a watchdog comment, then a run), `asked` — a person got the question.
 */
export async function stuckTasks(q: Pick<Q, 'execute'>, projectId: string | null) {
  return (
    await q.execute(
      sql`select t.id as "taskId", t.project_id as "projectId", t.space_id as "spaceId", t.created_by as "createdBy",
            t.parent_id as "parentId", p.key || '-' || t.number as key, s.name as status,
            floor(extract(epoch from now() - coalesce(act.at, t.created_at)) / 60)::int as min,
            t.status_id as "statusId", e.prev as "prevStatusId",
            exists (select 1 from comments c where c.task_id = t.id and c.author_id = b.id
              and c.created_at > coalesce(e.at, t.created_at) and c.body::text like ${`%${WATCH_MARK}%`}
              and exists (select 1 from ai_runs o where o.task_id = t.id and o.created_at > c.created_at)) as handed,
            exists (select 1 from comments c where c.task_id = t.id and c.author_id = b.id
              and c.created_at > coalesce(e.at, t.created_at) and c.body::text like ${`%${ASK_MARK}%`}) as asked,
            qa.id as "questionActionId", qa.question_status_id as "questionStatusId"
          from tasks t
          join users b on b.login = ${AI_BOT_LOGIN} and b.bot
          join task_assignees ta on ta.task_id = t.id and ta.user_id = b.id
          join projects p on p.id = t.project_id and 'ai' = any(p.modules)
          join statuses s on s.id = t.status_id and (s.category in ('todo', 'in_progress')
            or (s.category = 'backlog' and exists (select 1 from automations_rules r
              where r.project_id = t.project_id and r.enabled and r.trigger->>'type' = 'task.status_changed'
                and r.trigger->'to' ? s.id::text and r.actions @> '[{"type": "ai_run"}]'::jsonb)))
          left join lateral (select max(created_at) as at from activity where task_id = t.id) act on true
          left join lateral (select created_at as at, (changes->'statusId'->>0)::uuid as prev from activity
            where task_id = t.id and kind = 'updated' and changes->'statusId'->>1 = t.status_id::text
            order by created_at desc limit 1) e on true
          -- the action whose question status a question goes to: of the last run, else any of the project
          left join lateral (select a.id, a.question_status_id from ai_actions a
            left join ai_runs r on r.action_id = a.id and r.task_id = t.id
            where a.project_id = t.project_id and a.question_status_id is not null
            order by r.created_at desc nulls last, a.created_at limit 1) qa on true
          where t.archived_at is null ${projectId ? sql`and t.project_id = ${projectId}::uuid` : sql``}
            and coalesce(act.at, t.created_at) < now() - make_interval(mins => ${envInt('AI_STALL_MIN', 60)}::int)
            and not exists (select 1 from ai_runs o where o.task_id = t.id
              and o.state in ('queued', 'running', 'waiting_human', 'waiting_subtasks'))
            and not (exists (select 1 from ai_actions a where a.project_id = t.project_id and a.question_status_id = s.id)
              and exists (select 1 from comments c join users u on u.id = c.assignee_id and not u.bot
                where c.task_id = t.id and c.resolved_at is null))
            and not exists (select 1 from ai_retro rt where rt.task_id in (t.id, t.parent_id))
            and not ${openBlocker(sql`t.id`)}
            and not ${openSubtasks(sql`t.id`)}
            and not exists (select 1 from gitlab_mrs m where m.task_id = t.id and m.state = 'opened'
              and m.pipeline_status in ('created', 'waiting_for_resource', 'preparing', 'pending', 'running', 'scheduled'))
            and not exists (select 1 from automations_rules r where r.project_id = t.project_id and r.enabled
              and r.trigger->>'type' not in ('task.status_changed', 'task.created', 'task.assignee_changed')
              and jsonb_path_exists(r.conditions, '$.** ? (@.field == "status").value[*] ? (@ == $s)',
                jsonb_build_object('s', s.id::text)))
          order by t.updated_at limit 200`,
    )
  ).rows as {
    taskId: string;
    projectId: string;
    spaceId: string;
    createdBy: string;
    parentId: string | null;
    key: string;
    status: string;
    min: number;
    statusId: string;
    prevStatusId: string | null;
    handed: boolean;
    asked: boolean;
    questionActionId: string | null;
    questionStatusId: string | null;
  }[];
}

const ago = (min: number) => (min < 120 ? `${min} мин` : `${Math.floor(min / 60)} ч`);

/**
 * PLNRAPP-657: a stuck task — an error in the monitor's log; per entry into the status the stall goes to the AI
 * (PLNRAPP-764), and if the task is stuck again after that — a question to a person (PLNRAPP-740).
 */
async function watchPass(api: JobApi, t: Tracker, bot: string, projectId: string | null) {
  for (const s of await stuckTasks(api.db, projectId)) {
    await t.check();
    await t.step(`сторож: ${s.key} стоит в «${s.status}» ${ago(s.min)} без прогона ИИ`, {
      projectId: s.projectId,
      taskId: s.taskId,
      level: 'error',
    });
    if (s.asked) continue;
    if (s.handed) {
      await askPerson(api, t, bot, s);
      continue;
    }
    // PLNRAPP-773: no mention — a person is called only if the AI's analysis does not move the task
    const text = `${WATCH_MARK}: задача ${ago(s.min)} стоит в «${s.status}», а ИИ над ней не работает — нет ни прогона, ни правила, которое бы его запустило. ИИ, разберись по задаче и её комментариям, почему работа встала, и продолжи её сам: переведи задачу в статус, где работа пойдёт дальше, — или задай вопрос, если решить может только человек.`;
    const id = uuidv7();
    await api.execute(bot, [
      { name: 'comment.create', args: { id, taskId: s.taskId, body: asDoc(text) } },
    ]);
    // the stall the algorithm could not resolve — to the action «Разбор затыка» of the project (PLNRAPP-774), else
    // to the AI as an assignment (a bot's comment starts no run by itself)
    const a = await one(
      api.db,
      sql`select id from ai_actions where project_id = ${s.projectId} and key = ${UNSTICK}`,
    );
    const d: TaskRunData = a
      ? { kind: 'action', taskId: s.taskId, actionId: a.id as string, ruleId: null }
      : { kind: 'mention', taskId: s.taskId, itemId: id };
    await enqueueRun(api.db, api.enqueue, d, { singletonKey: keyOf(d), upsert: true });
    await t.step(`сторож: ${s.key} — затык передан ИИ${a ? ' на разбор' : ''}`, {
      projectId: s.projectId,
      taskId: s.taskId,
      level: 'action',
    });
    t.count();
  }
}

/** PLNRAPP-774: the key of the action the watchdog hands a stall to */
export const UNSTICK = 'unstick';

/**
 * PLNRAPP-774: the decision of a finished «Разбор затыка» — a line in the monitor's log, once (an event of the task
 * of the run; a question has no finished_at — its last update). A move — the status rule goes on; no move — the watchdog asks a person at its next look.
 */
async function unstickPass(api: JobApi, t: Tracker, projectId: string | null) {
  const found = (
    await api.db.execute(
      sql`select r.task_id as "taskId", r.project_id as "projectId", p.key || '-' || tk.number as key, r.state,
            (select st.name from activity v join statuses st on st.id = (v.changes->'statusId'->>1)::uuid
              where v.task_id = r.task_id and v.kind = 'updated' and v.changes ? 'statusId'
                and v.created_at > r.created_at
              order by v.created_at desc limit 1) as moved
          from ai_runs r join ai_actions a on a.id = r.action_id and a.key = ${UNSTICK}
          join tasks tk on tk.id = r.task_id join projects p on p.id = tk.project_id
          where r.state in ('done', 'failed', 'waiting_human', 'cancelled')
            and coalesce(r.finished_at, r.updated_at) > now() - interval '1 day'
            ${projectId ? sql`and r.project_id = ${projectId}::uuid` : sql``}
            and not exists (select 1 from ai_engine_events ev where ev.task_id = r.task_id
              and ev.at > r.created_at and ev.text like ${`%${UNSTICK_MARK}%`})
          limit 200`,
    )
  ).rows as {
    taskId: string;
    projectId: string;
    key: string;
    state: string;
    moved: string | null;
  }[];
  for (const r of found) {
    const what =
      r.state === 'waiting_human'
        ? 'вопрос человеку'
        : r.moved
          ? `задача переведена в «${r.moved}», работу продолжит правило статуса`
          : r.state === 'done'
            ? 'без изменений — сторож спросит человека'
            : 'прогон не выполнен — сторож спросит человека';
    await t.step(`сторож: ${r.key} — ${UNSTICK_MARK}: ${what}`, {
      projectId: r.projectId,
      taskId: r.taskId,
      level: 'action',
    });
  }
}
const UNSTICK_MARK = 'решение разбора затыка';

/**
 * PLNRAPP-740: the AI's own analysis of the stall did not move the task — the task's person gets the question
 * (assigned to them, the task in the question status: the state label of a pack comes from its rule).
 * PLNRAPP-773: as a run waiting for the answer — the answer returns the task to its status and its rule goes on.
 */
async function askPerson(
  api: JobApi,
  t: Tracker,
  bot: string,
  s: Awaited<ReturnType<typeof stuckTasks>>[number],
) {
  const human = await humanOf(api.db, { ...s, id: s.taskId });
  const inQuestion = s.statusId === s.questionStatusId;
  const back = inQuestion ? s.prevStatusId : s.statusId;
  const waits = !!(human && s.questionActionId && s.questionStatusId && back);
  const text = `${WATCH_MARK}: задача снова ${ago(s.min)} стоит в «${s.status}» — разбор ИИ её не сдвинул. ${ASK_MARK}: ${
    waits
      ? 'ответьте в ветке этого комментария — задача вернётся в работу и ИИ продолжит с учётом ответа. Или закройте её, или снимите ИИ с исполнителей.'
      : `ответьте здесь и верните задачу в «${s.status}» (или в статус, где работа пойдёт дальше), закройте её или снимите ИИ с исполнителей.`
  }`;
  const id = uuidv7();
  await api.execute(bot, [
    {
      name: 'comment.create',
      args: human
        ? {
            id,
            taskId: s.taskId,
            body: withMention(asDoc(text), human.id, human.login),
            assigneeId: human.id,
          }
        : { id, taskId: s.taskId, body: asDoc(text) },
    },
    ...(human
      ? [{ name: 'task.assign', args: { id: uuidv7(), taskId: s.taskId, userId: human.id } }]
      : []),
    ...(human && s.questionStatusId && !inQuestion
      ? [{ name: 'task.update', args: { id: s.taskId, statusId: s.questionStatusId } }]
      : []),
  ]);
  if (waits) {
    const runId = uuidv7();
    await api.db.execute(
      sql`insert into ai_runs (id, task_id, project_id, kind, action_id, state, chain_id, chain_depth,
            return_status_id, question_comment_ids, log)
          values (${runId}, ${s.taskId}, ${s.projectId}, 'action', ${s.questionActionId}, 'waiting_human', ${runId}, 0,
            ${back}, array[${id}::uuid], ${'движок: сторож: вопрос человеку — ответ вернёт задачу в работу\n'})`,
    );
  }
  await t.step(
    `сторож: ${s.key} — ${human ? `вопрос человеку (${human.login})` : 'некому задать вопрос'}`,
    { projectId: s.projectId, taskId: s.taskId, level: human ? 'action' : 'error' },
  );
  t.count();
}

/**
 * PLNRAPP-773: the answer that did not resume the run — the hook missed it, the resume job was lost (a restart
 * mid-way), or a person closed the question without a reply (their decision — the work goes on). A waiting run whose every question is closed with a person's reply in its thread → done and resumed;
 * an answered action run left with the task in the question status (the return did not happen) → resumed again.
 */
async function answeredPass(api: JobApi, t: Tracker, projectId: string | null) {
  const runs = (
    await api.db.execute(
      sql`select r.id, r.state, r.task_id as "taskId", r.project_id as "projectId", p.key || '-' || tk.number as key
          from ai_runs r join tasks tk on tk.id = r.task_id and tk.archived_at is null
            join projects p on p.id = tk.project_id
            left join ai_actions a on a.id = r.action_id
          where cardinality(r.question_comment_ids) > 0
            and (select count(*) from comments q where q.id = any(r.question_comment_ids))
              = cardinality(r.question_comment_ids)
            ${projectId ? sql`and r.project_id = ${projectId}::uuid` : sql``}
            and not exists (select 1 from comments q where q.id = any(r.question_comment_ids)
              -- a question closed by a person without a reply is their decision: go on without the answer
              and (q.resolved_at is null or not (exists (select 1 from comments x join users u on u.id = x.author_id
                  where x.parent_id = q.id and not u.bot)
                or exists (select 1 from users u where u.id = q.resolved_by and not u.bot))))
            and (r.state = 'waiting_human'
              or (r.state = 'done' and r.kind = 'action' and r.return_status_id is not null
                and tk.status_id = a.question_status_id and r.updated_at < now() - interval '5 minutes'
                and not exists (select 1 from ai_runs o where o.task_id = r.task_id and o.created_at > r.created_at)))
          order by r.created_at limit 50`,
    )
  ).rows as { id: string; state: string; taskId: string; projectId: string; key: string }[];
  for (const r of runs) {
    await t.check();
    if (r.state === 'waiting_human') {
      const moved = await one(
        api.db,
        sql`update ai_runs set state = 'done', log = log || ${'движок: сверка: на вопросы ответили — продолжение\n'},
            updated_at = now() where id = ${r.id} and state = 'waiting_human' returning id`,
      );
      if (!moved) continue;
    } else await note(api.db, r.id, 'сверка: на вопросы ответили, а задача не вернулась — возврат');
    await api.enqueue(AI_QUEUE, { kind: 'resume', runId: r.id });
    t.count();
    await t.step(`сверка: ${r.key} — на вопросы ответили, задача возвращается в работу`, {
      projectId: r.projectId,
      taskId: r.taskId,
      level: 'action',
    });
  }
}

/** PLNRAPP-741: why the reconcile ends a run waiting for an answer — in its log (the AI tab) and the restart's prompt */
export const LOST_QUESTION =
  'прогон сообщил о вопросе человеку, но открытого вопроса в задаче нет (не опубликован, удалён или закрыт без ответа) — ответа ждать неоткуда';

/**
 * PLNRAPP-741: a task run waits for a person (waiting_human), but nothing in the task waits for them: its question
 * comments are gone or closed without an answer, an assignment's comment is deleted, no letters wait for «ок».
 * No answer can come, and the run holds the task: the reconcile and the watchdog skip a task with a waiting run.
 * The run is failed with the reason and done again as attempt + 1 (its prompt reads the reason); the attempts spent —
 * it stays failed, the reason in its log, and the task's person gets a comment. No endless loop: every pass either
 * raises the attempt or leaves no waiting run.
 */
async function lostQuestionsPass(api: JobApi, t: Tracker, bot: string, projectId: string | null) {
  const lost = (
    await api.db.execute(
      sql`select r.id, r.kind, r.task_id as "taskId", r.project_id as "projectId", r.action_id as "actionId",
            r.rule_id as "ruleId", r.item_id as "itemId", r.attempt, a.max_attempts as "maxAttempts",
            tk.space_id as "spaceId", tk.created_by as "createdBy", tk.parent_id as "parentId",
            p.key || '-' || tk.number as key
          from ai_runs r join tasks tk on tk.id = r.task_id and tk.archived_at is null
            join projects p on p.id = tk.project_id
            left join ai_actions a on a.id = r.action_id
          where r.state = 'waiting_human' and r.kind in ('action', 'comment', 'mention', 'checklist')
            ${projectId ? sql`and r.project_id = ${projectId}::uuid` : sql``}
            and not exists (select 1 from ai_email_batches b where b.run_id = r.id and b.state = 'pending')
            and case
              when cardinality(r.question_comment_ids) > 0 then not exists (select 1 from comments c
                where c.id = any(r.question_comment_ids) and c.task_id = r.task_id and c.resolved_at is null)
              -- a question in the thread of an assignment: the answer comes in the thread of its comment
              when r.kind in ('comment', 'mention') then not exists (select 1 from comments c
                where c.id = r.item_id and c.task_id = r.task_id)
              else true end
          order by r.created_at limit 100`,
    )
  ).rows as {
    id: string;
    kind: 'action' | 'comment' | 'mention' | 'checklist';
    taskId: string;
    projectId: string;
    actionId: string | null;
    ruleId: string | null;
    itemId: string | null;
    attempt: number;
    maxAttempts: number | null;
    spaceId: string;
    createdBy: string;
    parentId: string | null;
    key: string;
  }[];
  for (const r of lost) {
    await t.check();
    const max = maxAttemptsOf(r);
    const again = r.attempt < max && (r.kind !== 'action' || !!r.actionId);
    const line = again
      ? `${LOST_QUESTION} — перезапуск, попытка ${r.attempt + 1} из ${max}`
      : LOST_QUESTION;
    const report: RunReport = {
      failures: [`Прошлый прогон: ${LOST_QUESTION}.`],
      lostQuestion: LOST_QUESTION,
    };
    const taken = await one(
      api.db,
      sql`update ai_runs set state = 'failed', report = ${JSON.stringify(report)}::jsonb,
          log = log || ${`движок: сверка: ${line}\n`}, updated_at = now()
          where id = ${r.id} and state = 'waiting_human' returning id`,
    );
    // answered or stopped meanwhile
    if (!taken) continue;
    if (again) {
      t.count();
      const base = { taskId: r.taskId, restartOf: r.id };
      const d: TaskRunData =
        r.kind === 'action'
          ? { kind: 'action', ...base, actionId: r.actionId!, ruleId: r.ruleId }
          : r.kind === 'checklist'
            ? { kind: 'checklist', ...base }
            : { kind: r.kind, ...base, itemId: r.itemId! };
      await enqueueRun(
        api.db,
        api.enqueue,
        d,
        { singletonKey: keyOf(d), upsert: true },
        r.attempt + 1,
      );
      await t.step(`сверка: ${r.key} — ${line}`, {
        projectId: r.projectId,
        taskId: r.taskId,
        level: 'action',
      });
      continue;
    }
    await stopLost(api, t, bot, r, LOST_QUESTION, max);
  }
}

/**
 * PLNRAPP-741: a failed run of a lost question (report.lostQuestion), its attempts spent: no more restarts — the reason
 * in its log (the AI tab), an error in the monitor's log and a comment to the task's person. Once: report.stopped.
 */
async function stopLost(
  api: JobApi,
  t: Tracker,
  bot: string,
  r: {
    id: string;
    taskId: string;
    projectId: string;
    spaceId: string;
    createdBy: string;
    parentId: string | null;
    key: string;
    attempt: number;
  },
  why: string,
  max: number,
) {
  const line = `${why} — попытки исчерпаны (${r.attempt} из ${max}), прогон остановлен`;
  const taken = await one(
    api.db,
    sql`update ai_runs set report = coalesce(report, '{"failures":[]}'::jsonb) || '{"stopped":true}'::jsonb,
        log = log || ${`движок: сверка: ${line}\n`}, updated_at = now()
        where id = ${r.id} and state = 'failed' and coalesce((report->>'stopped')::boolean, false) = false
        returning id`,
  );
  if (!taken) return;
  t.count();
  const human = await humanOf(api.db, { ...r, id: r.taskId });
  const text = `Прогон ИИ остановлен: ${why}. Попытки исчерпаны (${r.attempt} из ${max}). Причина — во вкладке ИИ задачи. Нужно решение человека: перезапустите прогон, переведите задачу дальше или снимите ИИ с исполнителей.`;
  await api.execute(bot, [
    {
      name: 'comment.create',
      args: human
        ? {
            id: uuidv7(),
            taskId: r.taskId,
            body: withMention(asDoc(text), human.id, human.login),
            assigneeId: human.id,
          }
        : { id: uuidv7(), taskId: r.taskId, body: asDoc(text) },
    },
  ]);
  await t.step(`сверка: ${r.key} — ${line}`, {
    projectId: r.projectId,
    taskId: r.taskId,
    level: 'error',
  });
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
