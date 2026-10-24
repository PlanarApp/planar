import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { Db, JobApi, JobDef, ModuleHookApi, MutationWrite } from '@planar/server-kit';
import { decrypt, secretKey } from './crypto.js';
import { gitlabConfig as C, gitlabMrs as M, gitlabProjects as P } from './schema.js';

const log = new Logger('gitlab');
const KEY_RE = /\b([A-Z][A-Z0-9]{1,9})-(\d+)\b/gi;
const DAY = 86_400_000;
const MAX_RETRY_AFTER_SEC = 300;

class Unauthorized extends Error {}
/** 429 без успешного повтора: проект ждёт следующего тика */
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
}

/** Детерминированный uuid строки (задача, проект GitLab, iid): повторный опрос не плодит строки. */
export function mrRowId(taskId: string, gitlabProjectId: number, iid: number): string {
  const h = createHash('sha1').update(`${taskId}:${gitlabProjectId}:${iid}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function keysOf(
  mr: Pick<GlMr, 'title' | 'source_branch' | 'description'>,
): [string, number][] {
  const text = [mr.title, mr.source_branch, mr.description].filter(Boolean).join('\n');
  const seen = new Map<string, [string, number]>();
  for (const m of text.matchAll(KEY_RE)) {
    const k: [string, number] = [m[1]!.toUpperCase(), Number(m[2])];
    seen.set(`${k[0]}-${k[1]}`, k);
  }
  return [...seen.values()];
}

const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

async function get(url: string, token: string): Promise<Response> {
  for (let retried = false; ; retried = true) {
    const res = await fetch(url, {
      headers: { 'PRIVATE-TOKEN': token },
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

/** Ответ GitLab на GET /projects/:id (для POST /api/gitlab/projects). */
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

async function syncMr(api: JobApi, gitlabProjectId: number, mr: GlMr) {
  const found = new Map<string, string>();
  for (const [key, number] of keysOf(mr)) {
    const r = await api.db.execute(
      sql`select t.id from tasks t join projects p on p.id = t.project_id
          where p.key = ${key} and t.number = ${number}`,
    );
    for (const row of r.rows as { id: string }[]) found.set(row.id, row.id);
  }
  if (!found.size) {
    const [had] = await api.db
      .select({ id: M.id })
      .from(M)
      .where(and(eq(M.gitlabProjectId, gitlabProjectId), eq(M.iid, mr.iid)))
      .limit(1);
    if (!had) return;
  }
  await api.execute(
    api.systemUserId,
    [
      {
        name: 'gitlab.mr.sync',
        args: {
          gitlabProjectId,
          iid: mr.iid,
          mr: {
            title: mr.title,
            sourceBranch: mr.source_branch,
            state: mr.state,
            authorName: mr.author?.name ?? mr.author?.username ?? '',
            webUrl: mr.web_url,
            mrUpdatedAt: new Date(mr.updated_at).toISOString(),
          },
          links: [...found.keys()].map((taskId) => ({
            id: mrRowId(taskId, gitlabProjectId, mr.iid),
            taskId,
          })),
        },
      },
    ],
    { system: true },
  );
}

async function pollProject(api: JobApi, base: string, token: string, p: typeof P.$inferSelect) {
  let cursor = p.cursor
    ? new Date(p.cursor).toISOString()
    : new Date(Date.now() - 30 * DAY).toISOString();
  let page = '1';
  while (page) {
    const url =
      `${base}/projects/${p.gitlabProjectId}/merge_requests?` +
      new URLSearchParams({
        updated_after: cursor,
        order_by: 'updated_at',
        sort: 'asc',
        per_page: '100',
        page,
      });
    const res = await get(url, token);
    const mrs = (await res.json()) as GlMr[];
    for (const mr of mrs) await syncMr(api, p.gitlabProjectId, mr);
    const last = mrs.at(-1);
    if (last) {
      cursor = new Date(last.updated_at).toISOString();
      await api.db.update(P).set({ cursor }).where(eq(P.id, p.id));
    }
    page = res.headers.get('x-next-page') ?? '';
  }
}

const setConfigError = (db: Db, e: string | null) =>
  db
    .update(C)
    .set({ lastError: e, lastErrorAt: e ? now() : null })
    .where(eq(C.id, 'default'));

/** Один проход по проектам. Не бросает: ошибки — в last_error. */
export async function pollAll(api: JobApi): Promise<void> {
  const [cfg] = await api.db.select().from(C).where(eq(C.id, 'default'));
  if (!cfg?.tokenEnc) return;
  if (cfg.lastError === 'unauthorized') return; // до смены токена
  const key = secretKey();
  let token: string;
  try {
    if (!key) throw new Error('secret_key_missing');
    token = decrypt(cfg.tokenEnc, key);
  } catch {
    const msg = key ? 'token_undecryptable' : 'secret_key_missing';
    log.warn(`gitlab: ${msg}`);
    await setConfigError(api.db, msg);
    return;
  }
  if (cfg.lastError) await setConfigError(api.db, null);
  const base = apiBase(cfg.baseUrl);
  for (const p of await api.db.select().from(P).orderBy(P.createdAt)) {
    let err: string | null = null;
    try {
      await pollProject(api, base, token, p);
    } catch (e) {
      if (e instanceof Unauthorized) {
        log.warn('gitlab: unauthorized');
        await setConfigError(api.db, 'unauthorized');
        return;
      }
      err = e instanceof Deferred ? 'rate_limited' : errText(e);
      log.warn(`gitlab: проект ${p.gitlabProjectId}: ${err}`);
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
      const [cfg] = await api.db.select().from(C).where(eq(C.id, 'default'));
      if (!cfg?.tokenEnc) return;
      const [r] = await api.db.select({ at: sql<string | null>`max(${P.lastPolledAt})` }).from(P);
      if (r?.at && Date.now() - new Date(r.at).getTime() < cfg.intervalSec * 1000) return;
      await api.enqueue('gitlab.poll', {}, { singletonKey: 'gitlab.poll' });
    },
  },
  {
    queue: 'gitlab.poll',
    retryLimit: 0,
    handler: (_, api) => pollAll(api),
  },
];

/** Удаление задачи уносит её строки gitlabMrs. */
export async function afterMutation(writes: MutationWrite[], _ctx: unknown, api: ModuleHookApi) {
  for (const w of writes) {
    if (w.entity !== 'tasks' || w.op !== 'del' || !w.before) continue;
    const e = 'gitlabMrs' as never;
    const rows = (await api.sys.scan(e, { index: 'taskId', eq: w.before.id })) as { id: string }[];
    for (const r of rows) await api.sys.del(e, r.id);
  }
}
