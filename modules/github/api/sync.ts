import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { decrypt, HttpError, isDemo, secretKey, type JobApi } from '@planar/server-kit';
import { firstLine, GITHUB_ERRORS, taskKeys, type GithubPrState } from '../shared/index.js';
import { failOf, ghGet, PAGE, unavailable } from './repos.js';
import { githubConnections as G, githubRepos as R } from './schema.js';

// PLNRAPP-892: one sync of a bound repository — its PRs (GET /pulls?state=all) and commits (GET /commits) are
// linked to the tasks of the binding's project by the task key in the branch, the PR title or the commit message.
// Called by hand (the project settings, the task's tab); the poller and webhooks of the parent task reuse it.

/** PRs: the newest by update, 10 pages × 100. */
const PR_PAGES = 10;
/** Commits of the default branch: the newest 3 pages × 100. */
const COMMIT_PAGES = 3;
/** Mutations per transaction. */
const BATCH = 50;

type Binding = typeof R.$inferSelect;

export interface PrData {
  number: number;
  title: string;
  branch: string;
  state: GithubPrState;
  authorLogin: string;
  webUrl: string;
  prUpdatedAt: string;
}
export interface CommitData {
  sha: string;
  /** the full message: keys are looked for in all of it, the first line is stored */
  message: string;
  authorName: string;
  webUrl: string;
  committedAt: string;
}

type RawPr = {
  number?: unknown;
  title?: unknown;
  state?: unknown;
  draft?: unknown;
  merged_at?: unknown;
  html_url?: unknown;
  updated_at?: unknown;
  head?: { ref?: unknown } | null;
  user?: { login?: unknown } | null;
};
type RawCommit = {
  sha?: unknown;
  html_url?: unknown;
  commit?: {
    message?: unknown;
    author?: { name?: unknown; date?: unknown } | null;
    committer?: { date?: unknown } | null;
  } | null;
  author?: { login?: unknown } | null;
};

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const iso = (v: unknown) => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/** A PR of GitHub's answer → the row data; merged — closed with merged_at, draft — an open draft. */
export function prOf(r: RawPr): PrData | null {
  const updated = iso(r.updated_at);
  if (typeof r.number !== 'number' || !updated || !str(r.html_url)) return null;
  const state: GithubPrState = r.merged_at
    ? 'merged'
    : r.state === 'closed'
      ? 'closed'
      : r.draft === true
        ? 'draft'
        : 'open';
  return {
    number: r.number,
    title: str(r.title).slice(0, 500),
    branch: str(r.head?.ref).slice(0, 500),
    state,
    authorLogin: str(r.user?.login).slice(0, 200),
    webUrl: str(r.html_url),
    prUpdatedAt: updated,
  };
}

/** A commit of GitHub's answer → the row data; the author — the git author's name, else the GitHub login. */
export function commitOf(r: RawCommit): CommitData | null {
  const at = iso(r.commit?.author?.date) ?? iso(r.commit?.committer?.date);
  if (typeof r.sha !== 'string' || r.sha.length < 7 || !at || !str(r.html_url)) return null;
  return {
    sha: r.sha,
    message: str(r.commit?.message),
    authorName: (str(r.commit?.author?.name) || str(r.author?.login)).slice(0, 200),
    webUrl: str(r.html_url),
    committedAt: at,
  };
}

const repoPath = (fullName: string) => {
  const [owner, name] = fullName.split('/');
  return `/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(name!)}`;
};

/** GET of a list page by page of 100 until a short page or `pages`; 404 — the repository is gone or hidden. */
async function list(token: string, path: string, pages: number): Promise<unknown[]> {
  const out: unknown[] = [];
  const sep = path.includes('?') ? '&' : '?';
  for (let page = 1; page <= pages; page++) {
    const res = await ghGet(token, `${path}${sep}per_page=${PAGE}&page=${page}`);
    // an empty repository: GET /commits answers 409 «Git Repository is empty»
    if (res.status === 409) break;
    if (res.status === 404) throw new HttpError(404, 'not_found', GITHUB_ERRORS.repoNotFound);
    if (!res.ok) throw failOf(res);
    const body = (await res.json().catch(() => null)) as unknown;
    if (!Array.isArray(body)) throw unavailable();
    out.push(...body);
    if (body.length < PAGE) break;
  }
  return out;
}

export async function fetchPulls(token: string, fullName: string): Promise<PrData[]> {
  const raw = await list(
    token,
    `${repoPath(fullName)}/pulls?state=all&sort=updated&direction=desc`,
    PR_PAGES,
  );
  return raw.map((r) => prOf(r as RawPr)).filter((x): x is PrData => !!x);
}

export async function fetchCommits(token: string, fullName: string): Promise<CommitData[]> {
  const raw = await list(token, `${repoPath(fullName)}/commits`, COMMIT_PAGES);
  return raw.map((r) => commitOf(r as RawCommit)).filter((x): x is CommitData => !!x);
}

/** Deterministic uuid of a row: a repeated sync does not create rows. */
export function rowId(...parts: (string | number)[]): string {
  const h = createHash('sha1').update(parts.join(':')).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

type Mut = { name: string; args: unknown };

async function run(api: JobApi, muts: Mut[]) {
  for (let i = 0; i < muts.length; i += BATCH)
    await api.execute(api.systemUserId, muts.slice(i, i + BATCH), { system: true });
}

export interface SyncResult {
  /** PRs linked to at least one task */
  prs: number;
  /** commits linked to at least one task */
  commits: number;
}

/**
 * One binding (project ↔ repository): PRs and commits from GitHub, linked to the project's tasks by the keys
 * (only the project's own key; tasks that don't exist are ignored). A PR without keys any more is unlinked.
 */
export async function syncBinding(
  api: JobApi,
  token: string,
  b: Pick<Binding, 'projectId' | 'repoId' | 'fullName'>,
  data?: { prs: PrData[]; commits: CommitData[] },
): Promise<SyncResult> {
  const prs = data?.prs ?? (await fetchPulls(token, b.fullName));
  const commits = data?.commits ?? (await fetchCommits(token, b.fullName));
  const p = await api.db.execute(sql`select key from projects where id = ${b.projectId}::uuid`);
  const key = p.rows[0]?.key as string | undefined;
  if (!key) return { prs: 0, commits: 0 };
  const numbersOf = (...texts: string[]) =>
    taskKeys(...texts)
      .filter(([k]) => k === key)
      .map(([, n]) => n);
  // the project's tasks by number
  const wanted = new Set<number>();
  for (const pr of prs) for (const n of numbersOf(pr.branch, pr.title)) wanted.add(n);
  for (const c of commits) for (const n of numbersOf(c.message)) wanted.add(n);
  const tasks = new Map<number, string>();
  if (wanted.size) {
    const r = await api.db.execute(
      sql`select id, number from tasks where project_id = ${b.projectId}::uuid and number in (${sql.join(
        [...wanted].map((n) => sql`${n}`),
        sql`, `,
      )})`,
    );
    for (const row of r.rows as { id: string; number: number }[])
      tasks.set(Number(row.number), row.id);
  }
  const taskIds = (ns: number[]) => [
    ...new Set(ns.map((n) => tasks.get(n)).filter((x): x is string => !!x)),
  ];
  // PRs already linked in this project: they are synced too (a key removed from the title — unlinked)
  const had = new Set(
    (
      await api.db.execute(
        sql`select distinct g.number from github_prs g join tasks t on t.id = g.task_id
            where g.repo_id = ${b.repoId} and t.project_id = ${b.projectId}::uuid`,
      )
    ).rows.map((r) => Number(r.number)),
  );
  const muts: Mut[] = [];
  let prCount = 0;
  for (const pr of prs) {
    const ids = taskIds(numbersOf(pr.branch, pr.title)).slice(0, 50);
    if (!ids.length && !had.has(pr.number)) continue;
    if (ids.length) prCount++;
    const { number, ...rest } = pr;
    muts.push({
      name: 'github.pr.sync',
      args: {
        projectId: b.projectId,
        repoId: b.repoId,
        number,
        pr: { repoFullName: b.fullName, ...rest },
        links: ids.map((taskId) => ({ id: rowId('pr', taskId, b.repoId, number), taskId })),
      },
    });
  }
  // commits: rows that exist are skipped (a commit does not change)
  const linked = commits
    .map((c) => ({
      c,
      links: taskIds(numbersOf(c.message))
        .slice(0, 50)
        .map((taskId) => ({ id: rowId('commit', taskId, b.repoId, c.sha), taskId })),
    }))
    .filter((x) => x.links.length);
  const ids = linked.flatMap((x) => x.links.map((l) => l.id));
  const exist = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    const r = await api.db.execute(
      sql`select id from github_commits where id in (${sql.join(
        part.map((x) => sql`${x}::uuid`),
        sql`, `,
      )})`,
    );
    for (const row of r.rows as { id: string }[]) exist.add(row.id);
  }
  for (const { c, links } of linked) {
    const fresh = links.filter((l) => !exist.has(l.id));
    if (!fresh.length) continue;
    muts.push({
      name: 'github.commit.sync',
      args: {
        projectId: b.projectId,
        repoId: b.repoId,
        commit: {
          repoFullName: b.fullName,
          sha: c.sha,
          message: firstLine(c.message),
          authorName: c.authorName,
          webUrl: c.webUrl,
          committedAt: c.committedAt,
        },
        links: fresh,
      },
    });
  }
  await run(api, muts);
  return { prs: prCount, commits: linked.length };
}

/** The decrypted token of a connection; none or broken — 503 / 409. */
async function tokenOfConnection(api: JobApi, connectionId: string): Promise<string> {
  const [c] = await api.db.select().from(G).where(eq(G.id, connectionId));
  if (!c) throw new HttpError(409, 'conflict', GITHUB_ERRORS.notConnected);
  const key = secretKey();
  if (!key) throw new HttpError(503, 'unavailable', 'PLANAR_SECRET_KEY не задан');
  try {
    return decrypt(c.tokenEnc, key);
  } catch {
    throw new HttpError(503, 'unavailable', 'Токен GitHub не расшифровывается');
  }
}

/** All repositories bound to the project, one by one with the token of its binding's connection. */
export async function syncProject(api: JobApi, projectId: string): Promise<SyncResult> {
  const sum: SyncResult = { prs: 0, commits: 0 };
  if (isDemo()) return sum; // demo: no outgoing requests
  const bs = await api.db.select().from(R).where(eq(R.projectId, projectId));
  for (const b of bs) {
    const r = await syncBinding(api, await tokenOfConnection(api, b.connectionId), b);
    sum.prs += r.prs;
    sum.commits += r.commits;
  }
  return sum;
}
