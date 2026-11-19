import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { textToDoc, uuidv7 } from '@planar/shared';
import {
  decrypt,
  isDemo,
  secretKey,
  type JobApi,
  type JobDef,
  type ModuleHookApi,
  type MutationWrite,
} from '@planar/server-kit';
import { gitlabConnections as P } from './schema.js';

const log = new Logger('gitlab');
const KEY_SRC = '\\b([A-Z][A-Z0-9]{1,9})-(\\d+)\\b';
const DAY = 86_400_000;
const INTERVAL_MS = 120_000;
const MAX_RETRY_AFTER_SEC = 300;
/** PLNRAPP-205: no pipeline of the merge on the target branch this long after the merge — deploy skipped */
const DEPLOY_WAIT_MS = 10 * 60_000;
/** pipeline statuses after which it does not change by itself; others are fetched again on every poll */
const FINAL = ['success', 'failed', 'canceled', 'skipped', 'manual'];

class Unauthorized extends Error {}
/** 429 without a successful retry: the project waits for the next tick */
class Deferred extends Error {}
class HttpFail extends Error {
  constructor(public status: number) {
    super(status === 404 ? 'not_found' : `http_${status}`);
  }
}

interface GlMr {
  iid: number;
  title: string;
  description: string | null;
  source_branch: string;
  state: string;
  web_url: string;
  updated_at: string;
  author?: { name?: string; username?: string } | null;
  target_branch?: string;
  sha?: string | null;
  merge_commit_sha?: string | null;
  squash_commit_sha?: string | null;
  merged_at?: string | null;
  /** only in GET of one MR */
  head_pipeline?: { status?: string } | null;
}

/** Deterministic uuid of a row (job, GitLab project, iid): a repeated poll does not create rows. */
export function mrRowId(taskId: string, gitlabProjectId: number, iid: number): string {
  const h = createHash('sha1').update(`${taskId}:${gitlabProjectId}:${iid}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/**
 * Task keys of an MR in priority order (PLNRAPP-406): the source branch first, then the title; the first
 * group that matches a task wins. The description is not scanned: it mentions other tasks.
 */
export function keysOf(mr: Pick<GlMr, 'title' | 'source_branch'>): [string, number][][] {
  // case matters only in the branch name
  const scan = (text: string | null, flags: string) => {
    const seen = new Map<string, [string, number]>();
    for (const m of (text ?? '').matchAll(new RegExp(KEY_SRC, flags))) {
      const k: [string, number] = [m[1]!.toUpperCase(), Number(m[2])];
      seen.set(`${k[0]}-${k[1]}`, k);
    }
    return [...seen.values()];
  };
  return [scan(mr.source_branch, 'gi'), scan(mr.title, 'g')];
}

const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

async function get(url: string, token: string, body?: object): Promise<Response> {
  for (let retried = false; ; retried = true) {
    const res = await fetch(url, {
      // with a body — POST (PLNRAPP-153: a branch, an MR)
      ...(body && { method: 'POST', body: JSON.stringify(body) }),
      headers: { 'PRIVATE-TOKEN': token, ...(body && { 'content-type': 'application/json' }) },
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 || res.status === 403) throw new Unauthorized();
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') ?? 1);
      if (retried || !(wait >= 0) || wait > MAX_RETRY_AFTER_SEC) throw new Deferred();
      await sleep(wait * 1000);
      continue;
    }
    if (!res.ok) throw new HttpFail(res.status);
    return res;
  }
}

/** GitLab's response to GET /projects/:id (for POST /api/gitlab/projects). */
export async function fetchProject(
  baseUrl: string,
  token: string,
  project: string,
): Promise<{ id: number; path: string }> {
  const res = await get(`${apiBase(baseUrl)}/projects/${encodeURIComponent(project)}`, token);
  const j = (await res.json()) as { id: number; path_with_namespace: string };
  return { id: j.id, path: j.path_with_namespace };
}

export { Unauthorized, HttpFail, Deferred };

const apiBase = (baseUrl: string) => `${baseUrl.replace(/\/+$/, '')}/api/v4`;

const repoOf = async (token: string, c: typeof P.$inferSelect) => {
  const repo = `${apiBase(c.baseUrl)}/projects/${c.gitlabProjectId}`;
  const p = (await (await get(repo, token)).json()) as { default_branch: string; web_url: string };
  return { repo, ...p };
};

/**
 * PLNRAPP-153: branch `branch` from the repository's default branch. An existing branch (GitLab 400
 * «Branch already exists») is not an error: it is reused.
 */
export async function createBranch(
  token: string,
  c: typeof P.$inferSelect,
  branch: string,
): Promise<{ webUrl: string }> {
  const p = await repoOf(token, c);
  try {
    await get(`${p.repo}/repository/branches`, token, { branch, ref: p.default_branch });
  } catch (e) {
    if (!(e instanceof HttpFail && e.status === 400)) throw e;
  }
  return { webUrl: `${p.web_url}/-/tree/${branch.split('/').map(encodeURIComponent).join('/')}` };
}

/** PLNRAPP-153: an MR from `branch` into the default branch, synced to the tasks at once (by the key in the title). */
export async function createMr(
  api: JobApi,
  token: string,
  c: typeof P.$inferSelect,
  branch: string,
  title: string,
): Promise<{ webUrl: string }> {
  const p = await repoOf(token, c);
  const res = await get(`${p.repo}/merge_requests`, token, {
    source_branch: branch,
    target_branch: p.default_branch,
    title,
  });
  const made = (await res.json()) as GlMr;
  await syncMr(api, c, made);
  return { webUrl: made.web_url };
}

/**
 * PLNRAPP-205: pipeline status of an MR. Open — of its head pipeline (GET of the MR); merged — of the target
 * branch pipeline with the merge commit (deploy): cancelled by a newer commit (auto_cancel) — of the newest one
 * on the branch; none for DEPLOY_WAIT_MS after the merge — `skipped`. undefined — not tracked (closed, old).
 */
async function pipelineOf(
  token: string,
  c: typeof P.$inferSelect,
  mr: GlMr,
): Promise<string | null | undefined> {
  const repo = `${apiBase(c.baseUrl)}/projects/${c.gitlabProjectId}`;
  if (mr.state === 'opened') {
    const full =
      'head_pipeline' in mr
        ? mr
        : ((await (await get(`${repo}/merge_requests/${mr.iid}`, token)).json()) as GlMr);
    return full.head_pipeline?.status ?? null;
  }
  if (mr.state !== 'merged' || !mr.merged_at || !mr.target_branch) return undefined;
  const age = Date.now() - new Date(mr.merged_at).getTime();
  if (age > DAY) return undefined;
  const sha = mr.merge_commit_sha ?? mr.squash_commit_sha ?? mr.sha;
  const last = async (q: Record<string, string>) => {
    const qs = new URLSearchParams({ ref: mr.target_branch!, per_page: '1', ...q });
    const list = (await (await get(`${repo}/pipelines?${qs}`, token)).json()) as {
      status: string;
    }[];
    return list[0]?.status;
  };
  let status = sha ? await last({ sha }) : undefined;
  if (status === 'canceled') status = await last({ updated_after: mr.merged_at });
  return status ?? (age > DEPLOY_WAIT_MS ? 'skipped' : null);
}

/** With `token`: the pipeline status of an MR linked to tasks is fetched too (PLNRAPP-205). */
async function syncMr(api: JobApi, c: typeof P.$inferSelect, mr: GlMr, token?: string) {
  const { projectId, gitlabProjectId } = c;
  const found = new Map<string, string>();
  for (const group of keysOf(mr)) {
    for (const [key, number] of group) {
      const r = await api.db.execute(
        sql`select t.id from tasks t join projects p on p.id = t.project_id
            where p.id = ${projectId} and p.key = ${key} and t.number = ${number}`,
      );
      for (const row of r.rows as { id: string }[]) found.set(row.id, row.id);
    }
    if (found.size) break;
  }
  if (!found.size) {
    const had = await api.db.execute(
      sql`select 1 from gitlab_mrs m join tasks t on t.id = m.task_id
          where m.gitlab_project_id = ${gitlabProjectId} and m.iid = ${mr.iid}
            and t.project_id = ${projectId} limit 1`,
    );
    if (!had.rows.length) return;
  }
  let pipelineStatus: string | null | undefined;
  if (token && found.size) pipelineStatus = await pipelineOf(token, c, mr);
  const onFail =
    pipelineStatus === 'failed' && mr.state === 'opened'
      ? await ciFailed(api, [...found.keys()], gitlabProjectId, mr)
      : [];
  await api.execute(
    api.systemUserId,
    [
      {
        name: 'gitlab.mr.sync',
        args: {
          projectId,
          gitlabProjectId,
          iid: mr.iid,
          mr: {
            title: mr.title,
            sourceBranch: mr.source_branch,
            state: mr.state,
            authorName: mr.author?.name ?? mr.author?.username ?? '',
            webUrl: mr.web_url,
            mrUpdatedAt: new Date(mr.updated_at).toISOString(),
            ...(pipelineStatus !== undefined && { pipelineStatus }),
          },
          links: [...found.keys()].map((taskId) => ({
            id: mrRowId(taskId, gitlabProjectId, mr.iid),
            taskId,
          })),
        },
      },
      ...onFail,
    ],
    { system: true },
  );
}

type Mut = { name: string; args: unknown };
/**
 * The MR's CI failed (it was not failed on the open MR before): a comment and an assignee in the batch of
 * gitlab.mr.sync. Autopilot — the AI bot (the rule dev_ci_failed sees it assigned and fixes), otherwise a person:
 * the last assigned human, else the author. A task the AI already has is left to that rule.
 */
async function ciFailed(api: JobApi, taskIds: string[], gitlabProjectId: number, mr: GlMr) {
  const muts: Mut[] = [];
  for (const taskId of taskIds) {
    const [r] = (
      await api.db.execute(
        sql`select
              (select pipeline_status = 'failed' and state = 'opened' from gitlab_mrs
                where id = ${mrRowId(taskId, gitlabProjectId, mr.iid)}) as "was",
              exists(select 1 from task_assignees a join users u on u.id = a.user_id
                where a.task_id = t.id and u.login = 'ai' and u.bot) as "aiHas",
              (select l.autopilot from ai_project_limits l
                where l.project_id = t.project_id and 'ai' = any(p.modules)
                  and exists(select 1 from settings where id = 'enabled_modules' and value @> '["ai"]'::jsonb)
              ) as "autopilot",
              (select id from users where login = 'ai' and bot and deactivated_at is null) as "bot",
              coalesce(
                (select u.id from task_assignees a join users u on u.id = a.user_id
                  join space_members m on m.user_id = u.id and m.space_id = t.space_id and m.role <> 'guest'
                  where a.task_id = t.id and not u.bot and u.deactivated_at is null
                  order by a.created_at desc limit 1),
                (select u.id from users u
                  join space_members m on m.user_id = u.id and m.space_id = t.space_id and m.role <> 'guest'
                  where u.id = t.created_by and not u.bot and u.deactivated_at is null)
              ) as "human"
            from tasks t join projects p on p.id = t.project_id where t.id = ${taskId}`,
      )
    ).rows as {
      was: boolean | null;
      aiHas: boolean;
      autopilot: boolean | null;
      bot: string | null;
      human: string | null;
    }[];
    if (!r || r.was || r.aiHas) continue;
    const to = r.autopilot && r.bot ? r.bot : r.human;
    const text = `CI упал в MR !${mr.iid}: ${mr.web_url} — ${to && to === r.bot ? 'назначаю ИИ на починку' : 'нужно починить'}.`;
    muts.push({
      name: 'comment.create',
      args: {
        id: uuidv7(),
        taskId,
        body: textToDoc(text, []),
        ...(to && to !== r.bot && { assigneeId: to }),
      },
    });
    if (to) muts.push({ name: 'task.assign', args: { id: uuidv7(), taskId, userId: to } });
  }
  return muts;
}

async function pollProject(api: JobApi, token: string, p: typeof P.$inferSelect) {
  const base = apiBase(p.baseUrl);
  const after = p.cursor
    ? new Date(p.cursor).toISOString()
    : new Date(Date.now() - 30 * DAY).toISOString();
  const seen = new Set<number>();
  let page = '1';
  while (page) {
    const url =
      `${base}/projects/${p.gitlabProjectId}/merge_requests?` +
      new URLSearchParams({
        updated_after: after,
        order_by: 'updated_at',
        sort: 'asc',
        per_page: '100',
        page,
      });
    const res = await get(url, token);
    const mrs = (await res.json()) as GlMr[];
    for (const mr of mrs) {
      await syncMr(api, p, mr, token);
      seen.add(mr.iid);
    }
    const last = mrs.at(-1);
    if (last) {
      const cursor = new Date(last.updated_at).toISOString();
      await api.db.update(P).set({ cursor }).where(eq(P.id, p.id));
    }
    page = res.headers.get('x-next-page') ?? '';
  }
  // PLNRAPP-205: a pipeline does not touch the MR's updated_at — unfinished ones are fetched again
  const pending = await api.db.execute(
    sql`select distinct m.iid from gitlab_mrs m join tasks t on t.id = m.task_id
        where m.gitlab_project_id = ${p.gitlabProjectId} and t.project_id = ${p.projectId}
          and (m.pipeline_status is null or m.pipeline_status not in (${sql.join(
            FINAL.map((x) => sql`${x}`),
            sql`, `,
          )}))
          and ((m.state = 'opened' and m.mr_updated_at > now() - interval '7 days')
            or (m.state = 'merged' and m.mr_updated_at > now() - interval '1 day'))`,
  );
  for (const r of pending.rows as { iid: number }[]) {
    if (seen.has(r.iid)) continue;
    let mr: GlMr;
    try {
      mr = (await (
        await get(`${base}/projects/${p.gitlabProjectId}/merge_requests/${r.iid}`, token)
      ).json()) as GlMr;
    } catch (e) {
      if (e instanceof HttpFail && e.status === 404) continue; // the MR is gone: the rows stay as they are
      throw e;
    }
    await syncMr(api, p, mr, token);
  }
}

/** One pass over the connections. Does not throw: errors go to the connection's last_error. */
export async function pollAll(api: JobApi): Promise<void> {
  if (isDemo()) return; // demo: no outgoing requests
  const conns = await api.db.select().from(P).orderBy(P.createdAt, P.id);
  if (!conns.length) return;
  // C-schema v16: projects where the module is off are not polled (connections stay)
  const on = new Set(
    (await api.db.execute(sql`select id from projects where 'gitlab' = any(modules)`)).rows.map(
      (r) => r.id,
    ),
  );
  await pollConnections(
    api,
    conns.filter((p) => on.has(p.projectId)),
  );
}

/** Poll of the given connections (PLNRAPP-153: of one project — from the task's GitLab tab). */
export async function pollConnections(api: JobApi, conns: (typeof P.$inferSelect)[]) {
  if (isDemo()) return;
  const key = secretKey();
  for (const p of conns) {
    if (p.lastError === 'unauthorized') continue; // before the token change
    let err: string | null = null;
    try {
      if (!key) throw new Error('secret_key_missing');
      let token: string;
      try {
        token = decrypt(p.tokenEnc, key);
      } catch {
        throw new Error('token_undecryptable');
      }
      await pollProject(api, token, p);
    } catch (e) {
      err =
        e instanceof Unauthorized
          ? 'unauthorized'
          : e instanceof Deferred
            ? 'rate_limited'
            : errText(e);
      log.warn(`gitlab: подключение ${p.id} (${p.gitlabProjectId}): ${err}`);
    }
    await api.db
      .update(P)
      .set({ lastPolledAt: now(), lastError: err, lastErrorAt: err ? now() : null })
      .where(eq(P.id, p.id));
  }
}

export const jobs: JobDef<Record<string, unknown>>[] = [
  {
    queue: 'gitlab.tick',
    cron: '* * * * *',
    async handler(_, api) {
      const [r] = await api.db
        .select({ n: sql<number>`count(*)::int`, at: sql<string | null>`max(${P.lastPolledAt})` })
        .from(P);
      if (!r?.n) return;
      if (r.at && Date.now() - new Date(r.at).getTime() < INTERVAL_MS) return;
      await api.enqueue('gitlab.poll', {}, { singletonKey: 'gitlab.poll' });
    },
  },
  {
    queue: 'gitlab.poll',
    retryLimit: 0,
    handler: (_, api) => pollAll(api),
  },
];

/** Deleting a task takes its gitlabMrs and gitlabBranches rows with it, deleting a project — its connections. */
export async function afterMutation(writes: MutationWrite[], _ctx: unknown, api: ModuleHookApi) {
  for (const w of writes) {
    if (w.op !== 'del' || !w.before) continue;
    if (w.entity === 'projects') {
      await api.q.delete(P).where(eq(P.projectId, w.before.id as string));
      continue;
    }
    if (w.entity !== 'tasks') continue;
    for (const e of ['gitlabMrs', 'gitlabBranches'] as never[]) {
      const rows = (await api.sys.scan(e, { index: 'taskId', eq: w.before.id })) as {
        id: string;
      }[];
      for (const r of rows) await api.sys.del(e, r.id);
    }
  }
}
