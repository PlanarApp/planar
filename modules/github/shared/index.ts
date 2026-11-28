import { z } from 'zod';
import { defineMutator, type EntityName, type SharedModuleManifest, type Tx } from '@planar/shared';

const ts = z.iso.datetime();
const id = z.uuid();

/** PR states as GitHub reports them: draft — an open draft, merged — closed with merged_at. */
export const PR_STATES = ['open', 'draft', 'merged', 'closed'] as const;
export type GithubPrState = (typeof PR_STATES)[number];

// PLNRAPP-892: PRs and commits of the bound repositories linked to tasks by the task key — sync entities as
// gitlabMrs: one row per (task, PR) / (task, commit), written by the server only
export const githubPrs = z.object({
  id,
  spaceId: id,
  taskId: id,
  repoId: z.number().int(),
  repoFullName: z.string().max(200),
  number: z.number().int(),
  title: z.string().max(500),
  branch: z.string().max(500),
  state: z.enum(PR_STATES),
  authorLogin: z.string().max(200),
  webUrl: z.string().max(2000),
  prUpdatedAt: ts,
  createdAt: ts,
  updatedAt: ts,
});
export const githubCommits = z.object({
  id,
  spaceId: id,
  taskId: id,
  repoId: z.number().int(),
  repoFullName: z.string().max(200),
  sha: z.string().min(7).max(64),
  /** the first line of the commit message */
  message: z.string().max(500),
  authorName: z.string().max(200),
  webUrl: z.string().max(2000),
  committedAt: ts,
  createdAt: ts,
  updatedAt: ts,
});
export type GithubPr = z.output<typeof githubPrs>;
export type GithubCommit = z.output<typeof githubCommits>;

const KEY_SRC = '\\b([A-Za-z][A-Za-z0-9]{1,9})-(\\d+)\\b';

/**
 * PLNRAPP-892: task keys «ABC-12» in the texts (branch name, PR title, commit message), case-insensitive,
 * upper-cased and without duplicates, in the order of appearance. Which of them are tasks — the caller decides.
 */
export function taskKeys(...texts: (string | null | undefined)[]): [string, number][] {
  const seen = new Map<string, [string, number]>();
  for (const text of texts)
    for (const m of (text ?? '').matchAll(new RegExp(KEY_SRC, 'gi'))) {
      const k: [string, number] = [m[1]!.toUpperCase(), Number(m[2])];
      if (!seen.has(`${k[0]}-${k[1]}`)) seen.set(`${k[0]}-${k[1]}`, k);
    }
  return [...seen.values()];
}

/** The first line of a commit message, ≤ 500. */
export const firstLine = (message: string) => (message.split(/\r?\n/, 1)[0] ?? '').slice(0, 500);

// Tx is typed with core entities; module entities are cast (C-modules), as in modules/gitlab
interface MTx {
  get(e: string, id: string): Promise<unknown>;
  put(e: string, row: unknown): Promise<void>;
  del(e: string, id: string): Promise<void>;
  scan(e: string, o?: { index: string; eq: unknown }): Promise<unknown[]>;
}
const mtx = (tx: Tx) => tx as unknown as MTx;
const E = (n: string) => n as EntityName;
const PRS = E('githubPrs');
const COMMITS = E('githubCommits');
const sameInstant = (a: string, b: string) => Date.parse(a) === Date.parse(b);

const links = z.array(z.object({ id, taskId: id })).max(50);

export const mutators = [
  defineMutator({
    name: 'github.pr.sync',
    // system only (write: server): the PR's rows on the tasks of the project — added, refreshed, unlinked
    args: z.object({
      projectId: id,
      repoId: z.number().int(),
      number: z.number().int(),
      pr: githubPrs.pick({
        repoFullName: true,
        title: true,
        branch: true,
        state: true,
        authorLogin: true,
        webUrl: true,
        prUpdatedAt: true,
      }),
      links,
    }),
    async run(tx, a, ctx) {
      const t = mtx(tx);
      // shortcut: a full table scan, as gitlab.mr.sync — no (repoId, number) index in the contract
      const old: GithubPr[] = [];
      for (const r of (await t.scan(PRS)) as GithubPr[])
        if (
          r.repoId === a.repoId &&
          r.number === a.number &&
          (await tx.get('tasks', r.taskId))?.projectId === a.projectId
        )
          old.push(r);
      const keep = new Set(a.links.map((l) => l.taskId));
      for (const r of old) if (!keep.has(r.taskId)) await t.del(PRS, r.id);
      const row = { ...a.pr, title: a.pr.title.slice(0, 500) };
      for (const l of a.links) {
        const task = await tx.get('tasks', l.taskId);
        if (!task || task.projectId !== a.projectId) continue;
        const prev = old.find((r) => r.taskId === l.taskId);
        const same =
          prev &&
          prev.repoFullName === row.repoFullName &&
          prev.title === row.title &&
          prev.branch === row.branch &&
          prev.state === row.state &&
          prev.authorLogin === row.authorLogin &&
          prev.webUrl === row.webUrl &&
          sameInstant(prev.prUpdatedAt, row.prUpdatedAt);
        if (same) continue;
        await t.put(PRS, {
          id: prev?.id ?? l.id,
          spaceId: task.spaceId,
          taskId: l.taskId,
          repoId: a.repoId,
          number: a.number,
          ...row,
          createdAt: prev?.createdAt ?? ctx.now,
          updatedAt: ctx.now,
        });
      }
    },
  }),
  defineMutator({
    name: 'github.commit.sync',
    // system only: a commit does not change — its rows on the tasks of the project are added once (ids are
    // deterministic: the same id again — kept)
    args: z.object({
      projectId: id,
      repoId: z.number().int(),
      commit: githubCommits.pick({
        repoFullName: true,
        sha: true,
        message: true,
        authorName: true,
        webUrl: true,
        committedAt: true,
      }),
      links,
    }),
    async run(tx, a, ctx) {
      const t = mtx(tx);
      for (const l of a.links) {
        const task = await tx.get('tasks', l.taskId);
        if (!task || task.projectId !== a.projectId) continue;
        if (await t.get(COMMITS, l.id)) continue;
        await t.put(COMMITS, {
          id: l.id,
          spaceId: task.spaceId,
          taskId: l.taskId,
          repoId: a.repoId,
          ...a.commit,
          message: a.commit.message.slice(0, 500),
          createdAt: ctx.now,
          updatedAt: ctx.now,
        });
      }
    },
  }),
  defineMutator({
    name: 'github.repo.drop',
    // system only: the repository is unbound from the project — its PRs and commits on the project's tasks go
    args: z.object({ projectId: id, repoId: z.number().int() }),
    async run(tx, a) {
      const t = mtx(tx);
      for (const e of [PRS, COMMITS])
        for (const r of (await t.scan(e)) as { id: string; taskId: string; repoId: number }[])
          if (r.repoId === a.repoId && (await tx.get('tasks', r.taskId))?.projectId === a.projectId)
            await t.del(e, r.id);
    },
  }),
];

// PLNRAPP-890: GitHub connections and bindings are server tables (not synced);
// PLNRAPP-892: PRs and commits of tasks are sync entities
export const shared: SharedModuleManifest = {
  id: 'github',
  mutators,
  entities: {
    githubPrs: {
      schema: githubPrs,
      meta: { scope: 'space', write: 'server', bootstrap: true, indexes: ['taskId'] },
    },
    githubCommits: {
      schema: githubCommits,
      meta: { scope: 'space', write: 'server', bootstrap: true, indexes: ['taskId'] },
    },
  },
};

/** scopeId of the workspace level (as in modules/gitlab). */
export const WORKSPACE_SCOPE_ID = '00000000-0000-0000-0000-000000000000';
/** Connection levels, as in modules/gitlab: a space / project uses its own connection or a parent's. */
export type GithubScope = 'workspace' | 'space' | 'project';

/** A github.com connection for the client: the token is never returned, neither plain nor encrypted. */
export interface GithubConnectionView {
  id: string;
  scope: GithubScope;
  scopeId: string;
  login: string;
  connectedBy: string;
  connectedAt: string;
}

/** GET /api/github/levels/:scope/:scopeId */
export interface GithubLevelView {
  /** own connections of the level and those of the levels above */
  connections: GithubConnectionView[];
  /** the level's own choice; null — inherits */
  choice: string | null;
  /** the connection in force for the level; null — none */
  effective: string | null;
}

export const GITHUB_ERRORS = {
  badToken: 'Токен GitHub недействителен или не имеет доступа',
  unavailable: 'GitHub недоступен, попробуйте позже',
  notConnected: 'Подключение GitHub не настроено',
  repoNotFound: 'Репозиторий не найден в GitHub или недоступен по токену подключения',
  hookNoRights:
    'Вебхук не создан: у токена нет прав на настройки репозитория — PR и коммиты обновляет опрос',
  hookFailed: 'Вебхук не создан — PR и коммиты обновляет опрос',
} as const;

/** PLNRAPP-891: a repository the project's connection has access to (GET /api/github/projects/:id/available). */
export interface GithubRepoOption {
  repoId: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
}

/** GET /api/github/projects/:projectId/available — connected: false — no connection for the project. */
export interface GithubAvailableView {
  connected: boolean;
  repos: GithubRepoOption[];
}

/** PLNRAPP-891: a project's bound repository. */
export interface GithubRepoView {
  id: string;
  projectId: string;
  connectionId: string;
  repoId: number;
  fullName: string;
  defaultBranch: string;
  /** PLNRAPP-894: the webhook is registered on GitHub; false — PRs and commits come by the poller only */
  hook: boolean;
  /** why the webhook was not registered (null — registered or not tried) */
  hookError: string | null;
}
