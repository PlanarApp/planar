import { HttpError } from '@planar/server-kit';
import { GITHUB_ERRORS, type GithubRepoOption } from '../shared/index.js';

// PLNRAPP-891: github.com REST calls with a connection's token — the repositories it has access to and one repository

export const GITHUB_API = 'https://api.github.com';
/** GitHub's maximum page size. */
export const PAGE = 100;
/** A guard against an endless pagination: 100 pages × 100 repositories. */
const MAX_PAGES = 100;

export const unavailable = () => new HttpError(502, 'unavailable', GITHUB_ERRORS.unavailable);

/**
 * GET with the token; no answer — 502 «GitHub недоступен». The status is the caller's business.
 * `headers` — extra request headers (PLNRAPP-893: If-None-Match of the poller).
 */
export async function ghGet(
  token: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return ghSend(token, 'GET', path, undefined, headers);
}

/** PLNRAPP-894: a request of any method with the token (a JSON body if given); no answer — 502. */
export async function ghSend(
  token: string,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  try {
    return await fetch(`${GITHUB_API}${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Planar',
        ...headers,
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw unavailable();
  }
}

/** The token was refused (revoked, invalid, no access) — 502 with the clear message; other failures — «недоступен». */
export const failOf = (res: Response) =>
  res.status === 401 || res.status === 403
    ? new HttpError(502, 'unavailable', GITHUB_ERRORS.badToken)
    : unavailable();

type RawRepo = {
  id?: unknown;
  full_name?: unknown;
  default_branch?: unknown;
  private?: unknown;
};
const optionOf = (r: RawRepo): GithubRepoOption | null =>
  typeof r.id === 'number' && typeof r.full_name === 'string'
    ? {
        repoId: r.id,
        fullName: r.full_name,
        defaultBranch: typeof r.default_branch === 'string' ? r.default_branch : 'main',
        private: r.private === true,
      }
    : null;

/**
 * All repositories of the token (GET /user/repos), page by page of 100 until a short page; `q` — a case-insensitive
 * part of full_name.
 */
export async function listRepos(token: string, q = ''): Promise<GithubRepoOption[]> {
  const out: GithubRepoOption[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await ghGet(token, `/user/repos?per_page=${PAGE}&page=${page}&sort=full_name`);
    if (!res.ok) throw failOf(res);
    const body = (await res.json().catch(() => null)) as unknown;
    if (!Array.isArray(body)) throw unavailable();
    for (const r of body as RawRepo[]) {
      const o = optionOf(r);
      if (o) out.push(o);
    }
    if (body.length < PAGE) break;
  }
  const needle = q.trim().toLowerCase();
  return needle ? out.filter((r) => r.fullName.toLowerCase().includes(needle)) : out;
}

/** One repository by full_name «owner/name»; 404 — not found or not visible to the token. */
export async function fetchRepo(token: string, fullName: string): Promise<GithubRepoOption> {
  const [owner, name] = fullName.split('/');
  const res = await ghGet(
    token,
    `/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(name!)}`,
  );
  if (res.status === 404) throw new HttpError(404, 'not_found', GITHUB_ERRORS.repoNotFound);
  if (!res.ok) throw failOf(res);
  const o = optionOf(((await res.json().catch(() => null)) ?? {}) as RawRepo);
  if (!o) throw unavailable();
  return o;
}
