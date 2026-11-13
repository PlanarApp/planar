// ai10: agent runs — the container is started by ai-runner (contract ai10-runner@3), the worker only starts it;
// the result, the heartbeat and the LLM proxy are HTTP calls of the container (agent.controller.ts), the reaper fails the lost ones.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { decrypt, secretKey, type JobApi, type Q } from '@planar/server-kit';
import { resolveConnection, secretOf } from './connections.js';
import { apply, botOf, contextOf, failed, finish, loadTask, md, type Run } from './run.js';

type Row = Record<string, unknown>;
const one = async (q: Pick<Q, 'execute'>, s: ReturnType<typeof sql>) =>
  (await q.execute(s)).rows[0] as Row | undefined;

const envInt = (name: string, def: number) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : def;
};
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Secret of the run → run row (id, state, projectId); wrong secret / not an agent run — 401 (null), not running — state. */
export async function runBySecret(q: Pick<Q, 'execute'>, id: string, secret: string | undefined) {
  if (!secret || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    return null;
  const r = await one(
    q,
    sql`select id, state, project_id as "projectId", agent_secret_hash as h from ai_runs where id = ${id}::uuid`,
  );
  const h = Buffer.from((r?.h as string | null) ?? '');
  const got = Buffer.from(sha256(secret));
  return r && h.length === got.length && timingSafeEqual(h, got)
    ? { id, state: r.state as string, projectId: r.projectId as string }
    : null;
}

async function runner(method: string, path: string, body?: object) {
  const base = process.env.AI_RUNNER_URL;
  if (!base) throw new Error('runner');
  return fetch(`${base.replace(/\/+$/, '')}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.AI_RUNNER_TOKEN ?? ''}`,
      ...(body && { 'content-type': 'application/json' }),
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
}

/** Removes the container of the run (idempotent on the runner side); best effort, never throws. */
export async function stopAgent(q: Pick<Q, 'execute'>, runId: string) {
  if (!process.env.AI_RUNNER_URL) return;
  // container_id is written only after the start answer: a start timeout / stop during start leaves the container with a null id
  const r = await one(
    q,
    sql`select 1 as x from ai_runs where id = ${runId}::uuid and agent_secret_hash is not null`,
  ).catch(() => undefined);
  if (r) await runner('DELETE', `/v1/runs/${runId}`).catch(() => {});
}

/** The limit of running containers is reached: the whole instance (AI_AGENT_MAX_REPLICAS) or the project (max_agents). */
export async function agentsFull(q: Pick<Q, 'execute'>, projectId: string) {
  const n = (await one(
    q,
    sql`select count(*)::int as i, (count(*) filter (where project_id = ${projectId}::uuid))::int as p
        from ai_runs where state = 'running' and agent_secret_hash is not null`,
  ))!;
  const l = await one(
    q,
    sql`select max_agents as m from ai_project_limits where project_id = ${projectId}::uuid`,
  );
  return (
    (n.i as number) >= envInt('AI_AGENT_MAX_REPLICAS', 2) ||
    (l?.m != null && (n.p as number) >= (l.m as number))
  );
}

/**
 * The project's GitLab repository for the agent: the token of the gitlab connection (PLNRAPP-177, scope `api` — the
 * agent pushes and opens MRs). null — the gitlab module is off, no connection, or the token cannot be decrypted.
 */
async function repoOf(q: Pick<Q, 'execute'>, run: Run) {
  if (!run.task.modules.includes('gitlab')) return null;
  // shortcut: the first connection of the project; when projects with several repositories need agents — pick in the action
  const c = await one(
    q,
    sql`select base_url as "baseUrl", token_enc as "tokenEnc", path from gitlab_connections
        where project_id = ${run.task.projectId} order by created_at, id limit 1`,
  );
  const key = secretKey();
  if (!c || !key) return null;
  try {
    const base = (c.baseUrl as string).replace(/\/+$/, '');
    return {
      token: decrypt(c.tokenEnc as string, key),
      host: new URL(base).host,
      url: `${base}/${c.path as string}.git`,
      path: c.path as string,
    };
  } catch {
    // the agent run's log lives in the row: run.log of the worker is not kept for agent runs
    await q.execute(
      sql`update ai_runs set log = log || ${'gitlab: токен подключения не расшифровывается\n'} where id = ${run.id}`,
    );
    return null;
  }
}

/**
 * Secrets the agent's log must not show (PLNRAPP-199): the provider key of the project's connection and the token of
 * its first gitlab connection (the run secret comes with the request). Undecryptable ones are skipped.
 */
export async function runSecretsOf(q: Q, projectId: string) {
  const out: string[] = [];
  const conn = await resolveConnection(q, projectId).catch(() => null);
  if (conn)
    try {
      out.push(secretOf(conn).apiKey);
    } catch {
      // no key to mask
    }
  const c = await one(
    q,
    sql`select token_enc as "tokenEnc" from gitlab_connections where project_id = ${projectId}::uuid order by created_at, id limit 1`,
  ).catch(() => undefined);
  const key = secretKey();
  if (c && key)
    try {
      out.push(decrypt(c.tokenEnc as string, key));
    } catch {
      // no token to mask
    }
  return out;
}

/** The open MR of the task in the project's repository (the first gitlab connection, as `repoOf`). */
export interface TaskMr {
  iid: number;
  title: string;
  sourceBranch: string;
  webUrl: string;
}

/**
 * PLNRAPP-195: an assignment (comment, @ai, a reply to the bot, checklist item) goes to the agent with the code when
 * the runner is configured, the gitlab module is on, the project has a connection and the task has an open MR in
 * its repository; null — the llm answer as before.
 */
export async function codeTargetOf(q: Pick<Q, 'execute'>, task: Run['task']) {
  if (!process.env.AI_RUNNER_URL || !task.modules.includes('gitlab')) return null;
  const mr = await one(
    q,
    sql`select m.iid, m.title, m.source_branch as "sourceBranch", m.web_url as "webUrl" from gitlab_mrs m
        where m.task_id = ${task.id} and m.state = 'opened'
          and m.gitlab_project_id = (select c.gitlab_project_id from gitlab_connections c
            where c.project_id = ${task.projectId} order by c.created_at, c.id limit 1)
        order by m.mr_updated_at desc, m.iid desc limit 1`,
  );
  return (mr as unknown as TaskMr | undefined) ?? null;
}

/**
 * The agent prompt of an assignment with the code: the MR branch, CI through glab, the answer in the thread.
 * `instruction` — the pack's instruction of the event: it replaces the built-in opening and result lines.
 */
export function codeAssignmentPrompt(mr: TaskMr, ask: string, instruction?: string) {
  const b = mr.sourceBranch;
  return `${instruction ? `${instruction}\n\n` : 'Выполни поручение человека по задаче. '}Поручение и ветка обсуждения — ниже, задача и все комментарии — в файле контекста.

У задачи открыт MR !${mr.iid} «${mr.title}» (${mr.webUrl}), ветка \`${b}\`. Репозиторий склонирован в текущий каталог, git push и glab работают.
- Правки кода — только в ветке MR: \`git fetch origin ${b} && git checkout ${b}\`, коммит, \`git push origin ${b}\`. Новую ветку и новый MR не создавай, в ветку по умолчанию не пушь.
- Статус и логи CI: \`glab ci list --branch ${b}\`, \`glab ci get --branch ${b}\` (задания пайплайна), \`glab ci trace <id задания>\`. Перезапуск: \`glab ci retry <id задания>\` или \`glab ci run --branch ${b}\`; после пуша пайплайн запускается сам.
- Следуй инструкциям репозитория (README, AGENTS.md, CLAUDE.md, CONTRIBUTING.md): тесты, линтер, формат коммитов. Перед пушем прогони тесты и линтер.
- Если поручение не требует правок кода — просто ответь по делу.
${!instruction ? '\nРезультат — в comment: что сделано, ссылка на коммит (если был), статус пайплайна. Меняй задачу (поля, метки, статус, подзадачи, план в описании) только если поручение этого прямо требует. Если без уточнения не обойтись — verdict question.\n' : ''}${ask}`;
}

/** Starts the container; the run stays `running` until the result, a stop or the reaper. */
export async function startAgentRun(
  api: JobApi,
  run: Run,
  prompt: string,
  ctx: Awaited<ReturnType<typeof contextOf>>,
  mr?: TaskMr | null,
): Promise<void> {
  if (!process.env.AI_RUNNER_URL) return apply(api, run, failed('Runner не настроен.'));
  const { task } = run;
  // an assignment with the code has no action: the built-in «Поручение»
  const action = run.action ?? {
    key: 'assignment',
    name: 'Поручение',
    model: null,
    checks: [] as string[],
  };
  const secret = randomBytes(32).toString('base64url');
  await api.db.execute(
    sql`update ai_runs set agent_secret_hash = ${sha256(secret)}, started_at = now(), updated_at = now() where id = ${run.id}`,
  );
  const comments = (
    await api.db.execute(
      sql`select * from (select c.id, c.parent_id as "parentId", u.name as author, c.body, c.created_at as "createdAt"
          from comments c join users u on u.id = c.author_id where c.task_id = ${task.id}
          order by c.created_at desc limit 100) x order by "createdAt"`,
    )
  ).rows.map((c) => ({ ...c, body: md(c.body) }));
  const repo = await repoOf(api.db, run);
  const conn = await resolveConnection(api.db, task.projectId);
  const context = JSON.stringify({
    runId: run.id,
    repo: repo && { url: repo.url, path: repo.path },
    task: {
      id: task.id,
      key: task.key,
      title: task.title,
      description: md(task.description),
      status: ctx.statuses.find((s) => s.id === task.statusId)?.name ?? null,
      comments,
    },
    action: { key: action.key, name: action.name, prompt },
    checks: action.checks,
    ...(mr && {
      mr: { iid: mr.iid, title: mr.title, sourceBranch: mr.sourceBranch, webUrl: mr.webUrl },
    }),
    ...(run.kind !== 'action' &&
      run.item && {
        assignment: {
          kind: run.kind,
          id: run.item.id,
          text: run.kind === 'checklist' ? (run.item.text as string) : md(run.item.body),
        },
      }),
  });
  const apiUrl = process.env.PLANAR_API_URL ?? 'http://api:3000';
  const proxy = process.env.AI_AGENT_PROXY_URL ?? 'http://squid:3128';
  const runUrl = `${apiUrl}/api/ai`;
  try {
    const res = await runner('POST', '/v1/runs', {
      runId: run.id,
      image: process.env.AI_AGENT_IMAGE ?? 'planar-ai-agent:latest',
      env: {
        PLANAR_RUN_ID: run.id,
        PLANAR_RUN_SECRET: secret,
        PLANAR_API_URL: apiUrl,
        PLANAR_LLM_URL: `${runUrl}/llm/${run.id}`,
        PLANAR_RESULT_URL: `${runUrl}/runs/${run.id}`,
        PLANAR_HEARTBEAT_URL: `${runUrl}/runs/${run.id}/heartbeat`,
        PLANAR_EVENTS_URL: `${runUrl}/runs/${run.id}/events`,
        PLANAR_CONTEXT_FILE: '/context/context.json',
        HTTP_PROXY: proxy,
        HTTPS_PROXY: proxy,
        NO_PROXY: 'api',
        ...(conn && {
          // what the proxy speaks to the provider: Anthropic Messages or OpenAI chat completions
          PLANAR_LLM_PROTOCOL: conn.provider === 'anthropic' ? 'anthropic' : 'openai',
          PLANAR_LLM_MODEL: action.model ?? conn.model,
        }),
        ...(repo && {
          PLANAR_REPO_URL: repo.url,
          GITLAB_HOST: repo.host,
          GITLAB_TOKEN: repo.token,
        }),
      },
      context,
    });
    if (res.status !== 201) {
      run.log.push(`runner: ${res.status}`);
      return await apply(api, run, failed('Не удалось запустить агента: runner отказал.'));
    }
    const { containerId } = (await res.json()) as { containerId?: string };
    await api.db.execute(
      sql`update ai_runs set container_id = ${containerId ?? null} where id = ${run.id}`,
    );
    // stopped / reaped while the container was starting: nobody else removes it
    const st = await one(api.db, sql`select state from ai_runs where id = ${run.id}::uuid`);
    if (st?.state !== 'running') await stopAgent(api.db, run.id);
  } catch {
    run.log.push('runner: недоступен');
    await stopAgent(api.db, run.id);
    await apply(api, run, failed('Не удалось запустить агента: runner недоступен.'));
  }
}

/**
 * The run row as `Run` for apply: an action, or an assignment with the code (with its comment / checklist item);
 * undefined — the task, the action or the item is gone.
 */
export async function loadRun(api: JobApi, id: string): Promise<Run | undefined> {
  const r = await one(
    api.db,
    sql`select task_id as "taskId", action_id as "actionId", kind, item_id as "itemId" from ai_runs where id = ${id}::uuid`,
  );
  const task = r && (await loadTask(api.db, r.taskId as string));
  const bot = await botOf(api);
  const action = r?.actionId
    ? ((await one(
        api.db,
        sql`select id, key, name, page_id as "pageId", runtime, model, question_status_id as "questionStatusId",
            checks, max_output_tokens as "maxOutputTokens" from ai_actions where id = ${r.actionId as string}`,
      )) as unknown as Run['action'])
    : undefined;
  const kind = r?.kind as Run['kind'] | undefined;
  if (!task || !bot || !kind) return undefined;
  if (kind === 'action') return action ? { id, kind, task, bot, action, log: [] } : undefined;
  const item = !r?.itemId
    ? undefined
    : kind === 'checklist'
      ? await one(
          api.db,
          sql`select id, text from checklist_items where id = ${r.itemId as string}`,
        )
      : await one(
          api.db,
          sql`select id, author_id as "authorId", assignee_id as "assigneeId", resolved_at as "resolvedAt", body
              from comments where id = ${r.itemId as string}`,
        );
  return item ? { id, kind, task, bot, item, log: [] } : undefined;
}

/** The result of the container, or a failure from the reaper, through the common apply. */
export async function finishAgent(api: JobApi, id: string, r: Parameters<typeof apply>[2]) {
  try {
    const run = await loadRun(api, id);
    if (!run)
      return void (await finish(
        api.db,
        { id, log: [] } as unknown as Run,
        'failed',
        'задача удалена',
      ));
    try {
      await apply(
        api,
        run,
        r,
        r.verdict === 'fail' ? undefined : await contextOf(api.db, run.task, run.bot),
      );
    } catch (e) {
      await finish(api.db, run, 'failed', `ошибка: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
  } finally {
    // the container is removed whatever the outcome (stopAgent never throws)
    await stopAgent(api.db, id);
  }
}

export const AGENT_REAP_QUEUE = 'ai.agent.reap';

/** Cron, every minute: no heartbeat for AI_AGENT_HEARTBEAT_TIMEOUT_SEC or running over AI_AGENT_TIMEOUT_MIN → container removed, run failed. */
export async function reap(_d: object, api: JobApi) {
  const hb = envInt('AI_AGENT_HEARTBEAT_TIMEOUT_SEC', 120);
  const max = envInt('AI_AGENT_TIMEOUT_MIN', 60);
  const lost = (
    await api.db.execute(
      sql`select id, coalesce(started_at, created_at) < now() - make_interval(mins => ${max}::int) as "timedOut" from ai_runs
          where state = 'running'
            and (agent_secret_hash is not null or action_id in (select id from ai_actions where runtime = 'agent'))
            and (coalesce(started_at, created_at) < now() - make_interval(mins => ${max}::int)
              or coalesce(heartbeat_at, started_at, created_at) < now() - make_interval(secs => ${hb}::float8))`,
    )
  ).rows as { id: string; timedOut: boolean }[];
  for (const l of lost) {
    await finishAgent(
      api,
      l.id,
      failed(
        l.timedOut
          ? `Агент остановлен: прогон длился дольше ${max} мин.`
          : 'Агент остановлен: нет сигнала heartbeat, результат не получен.',
      ),
    ).catch(() => {});
  }
}
