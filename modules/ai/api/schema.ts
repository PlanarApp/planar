import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = () => timestamp({ withTimezone: true, mode: 'string' });
// FK target only (modules do not import the core schema)
const tasks = pgTable('tasks', { id: uuid().primaryKey() });

// server table (not synced, outside the module gate): a connection to an AI provider per level;
// the nearest level wins: project → space → instance. The key is only encrypted (keyEnc), never returned.
export const aiConnections = pgTable(
  'ai_connections',
  {
    id: uuid().primaryKey(),
    /** instance | space | project */
    scope: text().notNull(),
    /** space or project id; the nil uuid for the instance */
    scopeId: uuid().notNull(),
    /** openai | anthropic | openai-compatible */
    provider: text().notNull(),
    baseUrl: text(),
    keyEnc: text().notNull(),
    model: text().notNull(),
    /** USD per 1M tokens */
    priceIn: doublePrecision(),
    priceOut: doublePrecision(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ai_connections_scope_uq').on(t.scope, t.scopeId)],
);

/** Synced (aiActions): what a rule `ai_run` runs; the prompt is the docs page pageId. */
export const aiActions = pgTable(
  'ai_actions',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    projectId: uuid().notNull(),
    key: text().notNull(),
    name: text().notNull(),
    description: text(),
    pageId: uuid(),
    runtime: text().notNull(),
    model: text(),
    questionStatusId: uuid(),
    checks: jsonb().notNull(),
    maxOutputTokens: integer(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [
    index('ai_actions_space_id_idx').on(t.spaceId),
    uniqueIndex('ai_actions_project_key_uq').on(t.projectId, t.key),
  ],
);

// server table: pack key → project entity (status, label, field, action, rule) created by "Apply harness"
export const aiHarnessKeys = pgTable(
  'ai_harness_keys',
  {
    id: uuid().primaryKey(),
    projectId: uuid().notNull(),
    /** status | label | field | action | rule */
    kind: text().notNull(),
    key: text().notNull(),
    entityId: uuid().notNull(),
  },
  (t) => [uniqueIndex('ai_harness_keys_project_kind_key_uq').on(t.projectId, t.kind, t.key)],
);

// server table: a harness pack loaded into the project docs
export const aiHarnessPacks = pgTable(
  'ai_harness_packs',
  {
    id: uuid().primaryKey(),
    projectId: uuid().notNull(),
    packKey: text().notNull(),
    active: boolean().notNull().default(false),
    rootPageId: uuid(),
    /** {pageId: sha256} of the pages at load time */
    hashes: jsonb().$type<Record<string, string>>().notNull().default({}),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ai_harness_packs_project_pack_uq').on(t.projectId, t.packKey)],
);

// server table: one AI run over a task — by a rule (kind action) or an assignment (comment, mention, checklist)
export const aiRuns = pgTable(
  'ai_runs',
  {
    id: uuid().primaryKey(),
    taskId: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    projectId: uuid().notNull(),
    /** action | comment | mention | checklist */
    kind: text().notNull(),
    actionId: uuid(),
    ruleId: uuid(),
    /** the comment (comment, mention) or checklist item the assignment came from */
    itemId: uuid(),
    /** running | waiting_human | done | failed | cancelled */
    state: text().notNull(),
    /** the first run of a chain of runs started by each other's changes */
    chainId: uuid().notNull(),
    chainDepth: integer().notNull(),
    /** status the task returns to when every question is answered */
    returnStatusId: uuid(),
    questionCommentIds: uuid().array().notNull().default([]),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    /** USD; null — the connection has no prices */
    cost: doublePrecision(),
    log: text().notNull().default(''),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [index('ai_runs_task_id_idx').on(t.taskId), index('ai_runs_state_idx').on(t.state)],
);
