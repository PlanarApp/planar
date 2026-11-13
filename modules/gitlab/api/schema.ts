import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = () => timestamp({ withTimezone: true, mode: 'string' });

// server table (not synced): a Planar project's connection to a GitLab repository
export const gitlabConnections = pgTable(
  'gitlab_connections',
  {
    id: uuid().primaryKey(),
    projectId: uuid().notNull(),
    baseUrl: text().notNull(),
    tokenEnc: text().notNull(),
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
    updatedAt: ts().notNull(),
  },
  (t) => [index('gitlab_project_settings_space_id_idx').on(t.spaceId)],
);
