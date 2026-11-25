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

// server table (not synced): a GitLab connection (host + token) of a level: workspace / space / project.
// scopeId of the workspace level is the nil uuid (as in ai_connections)
export const gitlabServers = pgTable(
  'gitlab_servers',
  {
    id: uuid().primaryKey(),
    scope: text().notNull(),
    scopeId: uuid().notNull(),
    name: text().notNull(),
    baseUrl: text().notNull(),
    tokenEnc: text().notNull(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index('gitlab_servers_scope_idx').on(t.scope, t.scopeId)],
);

// server table: the connection a level chose (a connection of its own or of a parent); no row — inherits
export const gitlabChoices = pgTable(
  'gitlab_choices',
  {
    scope: text().notNull(),
    scopeId: uuid().notNull(),
    serverId: uuid().notNull(),
  },
  (t) => [uniqueIndex('gitlab_choices_uq').on(t.scope, t.scopeId)],
);

// server table (not synced): a Planar project's binding to a GitLab repository on one of the connections
export const gitlabConnections = pgTable(
  'gitlab_connections',
  {
    id: uuid().primaryKey(),
    projectId: uuid().notNull(),
    serverId: uuid().notNull(),
    gitlabProjectId: integer().notNull(),
    path: text().notNull(),
    cursor: ts(),
    lastPolledAt: ts(),
    lastError: text(),
    lastErrorAt: ts(),
    createdAt: ts().notNull().defaultNow(),
  },
  // gitlabMrs rows are keyed by gitlabProjectId: one such id per Planar project, whatever the host
  (t) => [uniqueIndex('gitlab_connections_project_repo_uq').on(t.projectId, t.gitlabProjectId)],
);

// sync entities
export const gitlabMrs = pgTable(
  'gitlab_mrs',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    taskId: uuid().notNull(),
    gitlabProjectId: integer().notNull(),
    iid: integer().notNull(),
    title: text().notNull(),
    sourceBranch: text().notNull(),
    state: text().notNull(),
    authorName: text().notNull(),
    webUrl: text().notNull(),
    mrUpdatedAt: ts().notNull(),
    pipelineStatus: text(),
    // PLNRAPP-822: the job of that pipeline in GitLab (the pipeline page if no jobs)
    pipelineUrl: text(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [
    index('gitlab_mrs_task_id_idx').on(t.taskId),
    uniqueIndex('gitlab_mrs_mr_uq').on(t.taskId, t.gitlabProjectId, t.iid),
  ],
);

export const gitlabProjectSettings = pgTable(
  'gitlab_project_settings',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    mergedStatusId: uuid(),
    branchTemplate: text(),
    updatedAt: ts().notNull(),
  },
  (t) => [index('gitlab_project_settings_space_id_idx').on(t.spaceId)],
);

// PLNRAPP-153: branches created from the task's GitLab tab
export const gitlabBranches = pgTable(
  'gitlab_branches',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    taskId: uuid().notNull(),
    gitlabProjectId: integer().notNull(),
    name: text().notNull(),
    webUrl: text().notNull(),
    // PLNRAPP-822: the branch's last pipeline (id, status) and its job in GitLab
    // PLNRAPP-809: bigint — pipeline ids on gitlab.com exceed 2^31
    pipelineId: bigint({ mode: 'number' }),
    pipelineStatus: text(),
    pipelineUrl: text(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [
    index('gitlab_branches_task_id_idx').on(t.taskId),
    uniqueIndex('gitlab_branches_uq').on(t.taskId, t.gitlabProjectId, t.name),
  ],
);
