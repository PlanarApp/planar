import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { decrypt, encrypt, type Db, type JobApi } from '@planar/server-kit';
import { GITHUB_ERRORS } from '../shared/index.js';
import { ghSend } from './repos.js';
import { githubRepos as R } from './schema.js';
import { commitOf, prOf, repoPath, syncBinding, type CommitData } from './sync.js';

// PLNRAPP-894: GitHub webhooks of a bound repository — a hook per binding with its own secret (registered on bind,
// deleted on unbind), the signature check (X-Hub-Signature-256) and the push / pull_request events applied with
// the sync's logic (sync.ts syncBinding): rows have deterministic ids, so a repeated delivery adds nothing

const log = new Logger('github');

type Binding = typeof R.$inferSelect;

/** The events the hook is created with. */
export const HOOK_EVENTS = ['push', 'pull_request'] as const;
/** pull_request actions that change what the task shows (the rest — labels, reviews… — are ignored). */
export const PR_ACTIONS = new Set([
  'opened',
  'edited',
  'reopened',
  'synchronize',
  'closed',
  'ready_for_review',
  'converted_to_draft',
]);

const publicUrl = () => (process.env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
/** The endpoint of a binding's hook: the binding id tells which secret checks the signature. */
export const hookUrl = (bindingId: string) => `${publicUrl()}/api/github/webhook/${bindingId}`;

/** X-Hub-Signature-256 «sha256=<hex>» of the raw body by the secret, compared timing-safe. */
export function signatureOk(secret: string, raw: Buffer, header: unknown): boolean {
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const got = Buffer.from(header.slice(7), 'hex');
  const want = createHmac('sha256', secret).update(raw).digest();
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Creates the binding's hook (push, pull_request, JSON, a new secret). The secret is saved before the hook exists:
 * GitHub sends «ping» right away. No rights (403/404) or another refusal — the binding stays, hookError tells why
 * (the poller syncs it). Returns the row as saved.
 */
export async function registerHook(
  db: Pick<Db, 'update'>,
  token: string,
  b: Binding,
  key: Buffer,
): Promise<Binding> {
  const secret = randomBytes(32).toString('hex');
  const save = async (set: Partial<Binding>) => {
    const [r] = await db.update(R).set(set).where(eq(R.id, b.id)).returning();
    return r ?? { ...b, ...set };
  };
  await save({ hookSecretEnc: encrypt(secret, key), hookId: null, hookError: null });
  let hookError: string = GITHUB_ERRORS.hookFailed;
  try {
    const res = await ghSend(token, 'POST', `${repoPath(b.fullName)}/hooks`, {
      name: 'web',
      active: true,
      events: HOOK_EVENTS,
      config: { url: hookUrl(b.id), content_type: 'json', secret, insecure_ssl: '0' },
    });
    if (res.ok) {
      const j = (await res.json().catch(() => null)) as { id?: unknown } | null;
      if (typeof j?.id === 'number') return await save({ hookId: j.id });
    } else {
      if (res.status === 403 || res.status === 404) hookError = GITHUB_ERRORS.hookNoRights;
      const j = (await res.json().catch(() => null)) as { message?: unknown } | null;
      log.warn(`hook of ${b.fullName}: ${res.status} ${String(j?.message ?? '')}`);
    }
  } catch {
    /* GitHub did not answer: the poller syncs the binding */
  }
  return save({ hookError });
}

/** Deletes the binding's hook; 404 (already deleted) and other failures are not an obstacle to unbinding. */
export async function removeHook(token: string, fullName: string, hookId: number): Promise<void> {
  try {
    const res = await ghSend(token, 'DELETE', `${repoPath(fullName)}/hooks/${hookId}`);
    if (!res.ok && res.status !== 404)
      log.warn(`hook ${hookId} of ${fullName} not deleted: ${res.status}`);
  } catch {
    log.warn(`hook ${hookId} of ${fullName} not deleted: GitHub unavailable`);
  }
}

/** The binding's secret; null — no hook secret or it does not decrypt (the delivery is refused). */
export function secretOf(b: Binding, key: Buffer | null | undefined): string | null {
  if (!b.hookSecretEnc || !key) return null;
  try {
    return decrypt(b.hookSecretEnc, key);
  } catch {
    return null;
  }
}

type RawPushCommit = {
  id?: unknown;
  message?: unknown;
  timestamp?: unknown;
  url?: unknown;
  author?: { name?: unknown; username?: unknown } | null;
};

/** A commit of a push event → the row data (the shape of GET /commits for commitOf). */
const pushCommitOf = (c: RawPushCommit): CommitData | null =>
  commitOf({
    sha: c.id,
    html_url: c.url,
    commit: { message: c.message, author: { name: c.author?.name, date: c.timestamp } },
    author: { login: c.author?.username },
  });

/** What a verified delivery did: the event is applied or ignored. */
export type Handled = { event: string; applied: boolean };

/**
 * A verified delivery of the binding: pull_request — the PR on the tasks by its keys (an older state than the one
 * stored is skipped: deliveries may come out of order), push — its commits; other events are ignored.
 */
export async function handleEvent(
  api: JobApi,
  b: Binding,
  event: string,
  payload: unknown,
): Promise<Handled> {
  const p = (payload ?? {}) as {
    action?: unknown;
    pull_request?: unknown;
    commits?: unknown;
    deleted?: unknown;
  };
  if (event === 'pull_request') {
    if (typeof p.action !== 'string' || !PR_ACTIONS.has(p.action)) return { event, applied: false };
    const pr = prOf((p.pull_request ?? {}) as never);
    if (!pr) return { event, applied: false };
    const r = await api.db.execute(
      sql`select max(g.pr_updated_at) as at from github_prs g join tasks t on t.id = g.task_id
          where g.repo_id = ${b.repoId} and g.number = ${pr.number} and t.project_id = ${b.projectId}::uuid`,
    );
    const at = r.rows[0]?.at as string | Date | null | undefined;
    if (at && new Date(at).getTime() > Date.parse(pr.prUpdatedAt)) return { event, applied: false };
    await syncBinding(api, '', b, { prs: [pr], commits: [] });
    return { event, applied: true };
  }
  if (event === 'push') {
    if (p.deleted === true || !Array.isArray(p.commits)) return { event, applied: false };
    const commits = (p.commits as RawPushCommit[])
      .map(pushCommitOf)
      .filter((x): x is CommitData => !!x);
    if (!commits.length) return { event, applied: false };
    await syncBinding(api, '', b, { prs: [], commits });
    return { event, applied: true };
  }
  return { event, applied: false };
}
