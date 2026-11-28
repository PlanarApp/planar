import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = () => timestamp({ withTimezone: true, mode: 'string' });

// server table (not synced): a github.com connection (personal token) of a level: workspace / space / project,
// as gitlab_servers. scopeId of the workspace level is the nil uuid
export const githubConnections = pgTable(
  'github_connections',
  {
    id: uuid().primaryKey(),
    scope: text().notNull(),
    scopeId: uuid().notNull(),
    login: text().notNull(),
    // server-kit encrypt (PLANAR_SECRET_KEY), never returned by the API
    tokenEnc: text().notNull(),
    connectedBy: uuid().notNull(),
    createdAt: ts().notNull().defaultNow(),
    // PLNRAPP-893: GitHub's rate limit is per token — the poller sends no request through it before this time
    deferredUntil: ts(),
  },
  (t) => [index('github_connections_scope_idx').on(t.scope, t.scopeId)],
);

// server table: the connection a level chose (its own or of a parent level); no row — inherits (as gitlab_choices)
export const githubChoices = pgTable(
  'github_choices',
  {
    scope: text().notNull(),
    scopeId: uuid().notNull(),
    connectionId: uuid().notNull(),
  },
  (t) => [uniqueIndex('github_choices_uq').on(t.scope, t.scopeId)],
);

// PLNRAPP-891: server table (not synced): a Planar project's binding to a github.com repository through one of
// the connections (as gitlab_connections). One repository may be bound to several projects
export const githubRepos = pgTable(
  'github_repos',
  {
    id: uuid().primaryKey(),
    projectId: uuid().notNull(),
    connectionId: uuid().notNull(),
    // GitHub repository ids exceed 2^31
    repoId: bigint({ mode: 'number' }).notNull(),
    fullName: text().notNull(),
    defaultBranch: text().notNull(),
    createdAt: ts().notNull().defaultNow(),
    // PLNRAPP-893: the poller's cursor — the start of the last successful poll, ETags of the first pages of the PR
    // and commit lists (conditional requests), the last poll and its error
    syncedAt: ts(),
    prsEtag: text(),
    commitsEtag: text(),
    lastPolledAt: ts(),
    lastError: text(),
    // PLNRAPP-894: the binding's webhook on GitHub — its id (null: not created), the per-binding secret
    // (server-kit encrypt) and why it was not created (the token has no rights, the URL is not reachable…)
    hookId: bigint({ mode: 'number' }),
    hookSecretEnc: text(),
    hookError: text(),
  },
  (t) => [
    uniqueIndex('github_repos_project_repo_uq').on(t.projectId, t.repoId),
    index('github_repos_connection_idx').on(t.connectionId),
  ],
);

// PLNRAPP-892: sync entities — a bound repository's PRs and commits on the tasks whose key they carry
// (one row per task, as gitlab_mrs)
export const githubPrs = pgTable(
  'github_prs',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    taskId: uuid().notNull(),
    repoId: bigint({ mode: 'number' }).notNull(),
    repoFullName: text().notNull(),
    number: integer().notNull(),
    title: text().notNull(),
    branch: text().notNull(),
    state: text().notNull(),
    authorLogin: text().notNull(),
    webUrl: text().notNull(),
    prUpdatedAt: ts().notNull(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [
    index('github_prs_task_id_idx').on(t.taskId),
    uniqueIndex('github_prs_uq').on(t.taskId, t.repoId, t.number),
  ],
);

export const githubCommits = pgTable(
  'github_commits',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    taskId: uuid().notNull(),
    repoId: bigint({ mode: 'number' }).notNull(),
    repoFullName: text().notNull(),
    sha: text().notNull(),
    message: text().notNull(),
    authorName: text().notNull(),
    webUrl: text().notNull(),
    committedAt: ts().notNull(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [
    index('github_commits_task_id_idx').on(t.taskId),
    uniqueIndex('github_commits_uq').on(t.taskId, t.repoId, t.sha),
  ],
);
