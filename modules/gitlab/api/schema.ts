import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = () => timestamp({ withTimezone: true, mode: 'string' });

// server tables (not synced)
export const gitlabConfig = pgTable('gitlab_config', {
  id: text().primaryKey(),
  baseUrl: text().notNull(),
  tokenEnc: text(),
  intervalSec: integer().notNull().default(120),
  lastError: text(),
  lastErrorAt: ts(),
  updatedAt: ts().notNull().defaultNow(),
});

export const gitlabProjects = pgTable('gitlab_projects', {
  id: uuid().primaryKey(),
  gitlabProjectId: integer().notNull().unique(),
  path: text().notNull(),
  cursor: ts(),
  lastPolledAt: ts(),
  lastError: text(),
  lastErrorAt: ts(),
  createdAt: ts().notNull().defaultNow(),
});

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
