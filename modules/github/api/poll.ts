import { Logger } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  decrypt,
  HttpError,
  isDemo,
  secretKey,
  type JobApi,
  type JobDef,
} from '@planar/server-kit';
import { GITHUB_ERRORS } from '../shared/index.js';
import { failOf, ghGet, PAGE, unavailable } from './repos.js';
import { githubConnections as G, githubRepos as R } from './schema.js';
import {
  COMMIT_PAGES,
  commitOf,
  PR_PAGES,
  prOf,
  repoPath,
  syncBinding,
  type CommitData,
  type PrData,
} from './sync.js';

// PLNRAPP-893: the poller of the bound GitHub repositories (as modules/gitlab/api/poll.ts) — PRs and commits changed
// since the binding's cursor, conditional requests (If-None-Match: 304 does not count against the limit), the
// rate limit of the connection's token: exhausted — no request through the token before its reset

const log = new Logger('github');
const DAY = 86_400_000;
/** The same poll interval as the GitLab poller (modules/gitlab/api/poll.ts INTERVAL_MS). */
export const INTERVAL_MS = 120_000;
/** The cursor's overlap: late updated_at / commit dates near the cursor are not lost (rows are upserted). */
const OVERLAP_MS = 5 * 60_000;
/** The first poll of a binding looks this far back for commits. */
const FIRST_COMMITS_MS = 30 * DAY;
/** 429 / secondary limit without Retry-After and X-RateLimit-Reset — the deferral. */
const DEFAULT_DEFER_MS = 60_000;

type Binding = typeof R.$inferSelect;
type Connection = typeof G.$inferSelect;

/** The limit of the token is exhausted: nothing more is requested through it before `until` (ms). */
export class RateLimited extends Error {
  constructor(public until: number) {
    super('rate_limited');
  }
}

/**
 * The time (ms) before which the token must not be used, by the answer's headers; null — not limited.
 * 403 / 429 with Retry-After or an exhausted X-RateLimit-Remaining; 429 without them — DEFAULT_DEFER_MS.
 * A successful answer with X-RateLimit-Remaining: 0 also defers: the next request would be refused.
 */
export function limitOf(res: Response, now = Date.now()): number | null {
  const h = (n: string) => res.headers.get(n);
  const retry = h('retry-after') === null ? NaN : Number(h('retry-after'));
  const reset = Number(h('x-ratelimit-reset')) * 1000;
  const exhausted = h('x-ratelimit-remaining') === '0';
  const untilReset = exhausted && reset > now ? reset : null;
  if (res.status === 403 || res.status === 429) {
    const byRetry = retry >= 0 ? now + retry * 1000 : null;
    if (byRetry !== null || untilReset !== null)
      return Math.max(byRetry ?? 0, untilReset ?? 0, now + 1000);
    if (exhausted || res.status === 429) return now + DEFAULT_DEFER_MS;
    return null; // a plain 403: the token has no access
  }
  return res.ok && untilReset !== null ? untilReset : null;
}

/** The poll of one connection: its token and the deferral its answers set. */
interface Ctx {
  token: string;
  /** ms; a request is not sent before it */
  deferredUntil: number | null;
}

/** GET through the connection's token with the rate limit taken into account; 304 — null. */
async function get(ctx: Ctx, path: string, etag?: string | null): Promise<Response | null> {
  if (ctx.deferredUntil && ctx.deferredUntil > Date.now()) throw new RateLimited(ctx.deferredUntil);
  const res = await ghGet(ctx.token, path, etag ? { 'If-None-Match': etag } : {});
  const until = limitOf(res);
  if (until !== null) ctx.deferredUntil = Math.max(ctx.deferredUntil ?? 0, until);
  if (!res.ok && until !== null) throw new RateLimited(until);
  if (res.status === 304) return null;
  if (res.status === 404) throw new HttpError(404, 'not_found', GITHUB_ERRORS.repoNotFound);
  return res;
}

async function page(res: Response): Promise<unknown[]> {
  const body = (await res.json().catch(() => null)) as unknown;
  if (!Array.isArray(body)) throw unavailable();
  return body;
}

/**
 * PRs updated since `since` (newest first, pages until an older PR); the first page is conditional.
 * null — not modified (304).
 */
async function pullsSince(ctx: Ctx, b: Binding, since: number | null) {
  const out: PrData[] = [];
  let etag: string | null = null;
  for (let n = 1; n <= PR_PAGES; n++) {
    const path = `${repoPath(b.fullName)}/pulls?state=all&sort=updated&direction=desc&per_page=${PAGE}&page=${n}`;
    const res = await get(ctx, path, n === 1 ? b.prsEtag : null);
    if (!res) return null;
    if (!res.ok) throw failOf(res);
    if (n === 1) etag = res.headers.get('etag');
    const body = await page(res);
    let older = false;
    for (const raw of body) {
      const pr = prOf(raw as Parameters<typeof prOf>[0]);
      if (!pr) continue;
      if (since !== null && Date.parse(pr.prUpdatedAt) < since) older = true;
      else out.push(pr);
    }
    if (older || body.length < PAGE) break;
  }
  return { prs: out, etag };
}

/** Commits of the default branch since `since`; the first page is conditional. null — not modified (304). */
async function commitsSince(ctx: Ctx, b: Binding, since: number) {
  const out: CommitData[] = [];
  let etag: string | null = null;
  const at = encodeURIComponent(new Date(since).toISOString());
  for (let n = 1; n <= COMMIT_PAGES; n++) {
    const path = `${repoPath(b.fullName)}/commits?since=${at}&per_page=${PAGE}&page=${n}`;
    const res = await get(ctx, path, n === 1 ? b.commitsEtag : null);
    if (!res) return null;
    // an empty repository: GET /commits answers 409 «Git Repository is empty»
    if (res.status === 409) break;
    if (!res.ok) throw failOf(res);
    if (n === 1) etag = res.headers.get('etag');
    const body = await page(res);
    for (const raw of body) {
      const c = commitOf(raw as Parameters<typeof commitOf>[0]);
      if (c) out.push(c);
    }
    if (body.length < PAGE) break;
  }
  return { commits: out, etag };
}

/** One binding: what changed since its cursor → syncBinding; the cursor and ETags move only after a success. */
async function pollBinding(api: JobApi, ctx: Ctx, b: Binding) {
  const started = Date.now();
  const cursor = b.syncedAt ? Date.parse(b.syncedAt) - OVERLAP_MS : null;
  const pulls = await pullsSince(ctx, b, cursor);
  const commits = await commitsSince(ctx, b, cursor ?? started - FIRST_COMMITS_MS);
  if (pulls?.prs.length || commits?.commits.length)
    await syncBinding(api, ctx.token, b, {
      prs: pulls?.prs ?? [],
      commits: commits?.commits ?? [],
    });
  await api.db
    .update(R)
    .set({
      syncedAt: new Date(started).toISOString(),
      // 304 — the stored ETag stays valid
      prsEtag: pulls ? pulls.etag : b.prsEtag,
      commitsEtag: commits ? commits.etag : b.commitsEtag,
      lastPolledAt: new Date().toISOString(),
      lastError: null,
    })
    .where(eq(R.id, b.id));
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

async function markPolled(api: JobApi, ids: string[], lastError: string) {
  if (!ids.length) return;
  await api.db
    .update(R)
    .set({ lastPolledAt: new Date().toISOString(), lastError })
    .where(inArray(R.id, ids));
}

/**
 * The bindings of one connection. Deferred — no request at all; the limit runs out — the rest of its bindings wait
 * for the reset; any other error of a binding (404, network, a revoked token) is logged and the next one is polled.
 */
async function pollConnection(api: JobApi, c: Connection, bs: Binding[], key: Buffer | undefined) {
  const ids = bs.map((b) => b.id);
  const deferred = c.deferredUntil ? Date.parse(c.deferredUntil) : null;
  if (deferred && deferred > Date.now()) {
    await markPolled(api, ids, 'rate_limited');
    return;
  }
  let token: string;
  try {
    if (!key) throw new Error('secret_key_missing');
    token = decrypt(c.tokenEnc, key);
  } catch (e) {
    const err = key ? 'token_undecryptable' : errText(e);
    log.warn(`github: подключение ${c.id}: ${err}`);
    await markPolled(api, ids, err);
    return;
  }
  const ctx: Ctx = { token, deferredUntil: null };
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i]!;
    try {
      await pollBinding(api, ctx, b);
    } catch (e) {
      if (e instanceof RateLimited) {
        await markPolled(api, ids.slice(i), 'rate_limited');
        break;
      }
      const err = errText(e);
      log.warn(`github: репозиторий ${b.fullName} (привязка ${b.id}): ${err}`);
      await markPolled(api, [b.id], err);
    }
  }
  const until = ctx.deferredUntil && ctx.deferredUntil > Date.now() ? ctx.deferredUntil : null;
  if (until)
    log.warn(
      `github: лимит запросов GitHub подключения ${c.id} исчерпан, опрос отложен до ${new Date(until).toISOString()}`,
    );
  if (until || c.deferredUntil)
    await api.db
      .update(G)
      .set({ deferredUntil: until ? new Date(until).toISOString() : null })
      .where(eq(G.id, c.id));
}

/** One pass over the bindings of projects with the module on. Does not throw: errors go to the binding's last_error. */
export async function pollAll(api: JobApi): Promise<void> {
  if (isDemo()) return; // demo: no outgoing requests
  const bs = await api.db
    .select()
    .from(R)
    .where(sql`${R.projectId} in (select id from projects where 'github' = any(modules))`)
    .orderBy(R.createdAt, R.id);
  if (!bs.length) return;
  const conns = await api.db
    .select()
    .from(G)
    .where(inArray(G.id, [...new Set(bs.map((b) => b.connectionId))]));
  const key = secretKey();
  for (const c of conns)
    await pollConnection(
      api,
      c,
      bs.filter((b) => b.connectionId === c.id),
      key,
    );
}

export const jobs: JobDef<Record<string, unknown>>[] = [
  {
    queue: 'github.tick',
    cron: '* * * * *',
    async handler(_, api) {
      // the oldest poll of a binding (as gitlab.tick)
      const [r] = await api.db
        .select({
          n: sql<number>`count(*)::int`,
          at: sql<string | null>`min(coalesce(${R.lastPolledAt}, 'epoch'))`,
        })
        .from(R);
      if (!r?.n) return;
      if (r.at && Date.now() - new Date(r.at).getTime() < INTERVAL_MS) return;
      await api.enqueue('github.poll', {}, { singletonKey: 'github.poll' });
    },
  },
  {
    queue: 'github.poll',
    retryLimit: 0,
    handler: (_, api) => pollAll(api),
  },
];
