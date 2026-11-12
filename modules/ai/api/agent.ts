// ai10: agent runs — the container is started by ai-runner (contract ai10-runner@3), the worker only starts it;
// the result, the heartbeat and the LLM proxy are HTTP calls of the container (agent.controller.ts), the reaper fails the lost ones.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { decrypt, secretKey, type JobApi, type Q } from '@planar/server-kit';
import { resolveConnection } from './connections.js';
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

/** Starts the container; the run stays `running` until the result, a stop or the reaper. */
export async function startAgentRun(
  api: JobApi,
  run: Run,
  prompt: string,
  ctx: Awaited<ReturnType<typeof contextOf>>,
): Promise<void> {
  if (!process.env.AI_RUNNER_URL) return apply(api, run, failed('Runner не настроен.'));
  const { task, action } = run;
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
    action: { key: action!.key, name: action!.name, prompt },
    checks: action!.checks,
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
        PLANAR_CONTEXT_FILE: '/context/context.json',
        HTTP_PROXY: proxy,
        HTTPS_PROXY: proxy,
        NO_PROXY: 'api',
        ...(conn && {
          // what the proxy speaks to the provider: Anthropic Messages or OpenAI chat completions
          PLANAR_LLM_PROTOCOL: conn.provider === 'anthropic' ? 'anthropic' : 'openai',
          PLANAR_LLM_MODEL: action!.model ?? conn.model,
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

/** The run row as `Run` for apply (agent runs are actions only); undefined — the task is gone. */
export async function loadRun(api: JobApi, id: string): Promise<Run | undefined> {
  const r = await one(
    api.db,
    sql`select task_id as "taskId", action_id as "actionId" from ai_runs where id = ${id}::uuid`,
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
  return task && bot && action ? { id, kind: 'action', task, bot, action, log: [] } : undefined;
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
        r.verdict === 'done' ? await contextOf(api.db, run.task, run.bot) : undefined,
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
