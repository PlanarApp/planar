// PLNRAPP-404: the engine — the system accepts a run's result by the action's checks instead of the AI's own word,
// sends it back for rework, restarts lost runs and picks up the tasks that stand in a status of an action.
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { JobApi, Q } from '@planar/server-kit';
import { uuidv7 } from '@planar/shared';
import { matched } from '@planar/module-automations/api';
import { resolveConnection, secretOf } from './connections.js';
import { generateStructured } from './llm.js';
import type { RunReport } from './schema.js';
import {
  aiEnabled,
  botOf,
  enqueueRun,
  failed,
  keyOf,
  type AiResult,
  type contextOf,
  type Run,
  type TaskRunData,
} from './run.js';

type Row = Record<string, unknown>;
const one = async (q: Pick<Q, 'execute'>, s: ReturnType<typeof sql>) =>
  (await q.execute(s)).rows[0] as Row | undefined;

/** «$ command» — an executable check: the agent's container runs it, exit code 0 passes */
export const isCommand = (c: string) => c.startsWith('$ ');

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

/** The remarks of the acceptance; [] — accepted. A provider error of the LLM check accepts (it says nothing of the work). */
async function accept(
  api: JobApi,
  run: Run,
  r: CheckedResult,
  ctx: Awaited<ReturnType<typeof contextOf>>,
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
  if (!criteria.length && !r.uncertain) return failures;
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
          criteria.map((x) => `- ${x}`).join('\n') || '— (проверь только сомнения)'
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
  if (!run.action?.checks.length && !r.uncertain) return false;
  const failures = await accept(api, run, r, ctx);
  if (!failures.length) {
    if (run.action?.checks.length) run.log.push('движок: результат принят проверками');
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
 * A done, cancelled (stopped by a person) or active run is left alone.
 */
export async function reconcile(_d: object, api: JobApi) {
  if (!(await aiEnabled(api.db))) return;
  const bot = await botOf(api);
  if (!bot) return;
  const found = (
    await api.db.execute(
      sql`select x.rule_id as "ruleId", x.action_id as "actionId", t.id as "taskId", t.status_id as "statusId",
            l.id as "lastId", l.state, l.attempt, a.max_attempts as "maxAttempts",
            l.finished_at < now() - make_interval(secs => 60 * l.attempt) as "paused"
          from (select r.id as rule_id, r.project_id, r.trigger, (e->>'aiActionId')::uuid as action_id
                from automations_rules r cross join lateral jsonb_array_elements(r.actions) e
                where r.enabled and r.trigger->>'type' = 'task.status_changed' and e->>'type' = 'ai_run') x
          join projects p on p.id = x.project_id and 'ai' = any(p.modules) and 'automations' = any(p.modules)
          join ai_actions a on a.id = x.action_id and a.project_id = x.project_id
          join tasks t on t.project_id = x.project_id and t.archived_at is null
            and x.trigger->'to' ? t.status_id::text
          join task_assignees ta on ta.task_id = t.id and ta.user_id = ${bot}
          left join lateral (select id, state, attempt, finished_at from ai_runs
            where task_id = t.id and action_id = x.action_id order by created_at desc limit 1) l on true
          where l.id is null or l.state = 'failed'
          limit 200`,
    )
  ).rows as {
    ruleId: string;
    actionId: string;
    taskId: string;
    statusId: string;
    lastId: string | null;
    attempt: number | null;
    maxAttempts: number | null;
    paused: boolean | null;
  }[];
  for (const f of found) {
    if (f.lastId && (!f.paused || f.attempt! >= maxAttemptsOf(f))) continue;
    if (!(await matched(api, f.ruleId, f.taskId))) continue;
    const runId = uuidv7();
    const d = {
      kind: 'action' as const,
      taskId: f.taskId,
      actionId: f.actionId,
      ruleId: f.ruleId,
      statusId: f.statusId,
      restartOf: f.lastId,
      runId,
    };
    await enqueueRun(
      api.db,
      api.enqueue,
      d,
      { singletonKey: keyOf(d), upsert: true },
      (f.attempt ?? 0) + 1,
    );
    await note(
      api.db,
      runId,
      f.lastId ? 'сверка: повтор упавшего запуска' : 'сверка: задача стоит в статусе действия',
    );
  }
}
