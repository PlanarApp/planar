import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
    /** null — a chat run */
    taskId: uuid().references(() => tasks.id, { onDelete: 'cascade' }),
    /** null — a chat run in a channel without a project */
    projectId: uuid(),
    /** the channel of a chat run (item_id — the message) */
    channelId: uuid(),
    /** action | comment | mention | checklist | chat */
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
    /** the run this one restarts by hand (the chain of restarts is limited) */
    restartOf: uuid(),
    /** a chat run waiting for the initiator's «да»: the dangerous calls the bot planned and the thread to answer in */
    pending: jsonb().$type<ChatPending>(),
    /** agent run: sha256 of the container's one-time secret (the secret itself is never stored) */
    agentSecretHash: text(),
    containerId: text(),
    heartbeatAt: ts(),
    startedAt: ts(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    index('ai_runs_task_id_idx').on(t.taskId),
    index('ai_runs_state_idx').on(t.state),
    index('ai_runs_project_id_created_at_idx').on(t.projectId, t.createdAt),
    index('ai_runs_created_at_idx').on(t.createdAt),
  ],
);

export type ChatPending = {
  calls: { name: string; args: unknown }[];
  /** parent_id of the bot's plan message (null — a flat dialog): «да» must come in the same thread */
  parentId: string | null;
};

export type AiEmail = {
  to: string;
  subject: string;
  body: string;
  state: 'queued' | 'sent' | 'failed';
  error?: string;
};

// server table: emails of a run, sent only after the executor's «ок» in the thread of the batch comment
export const aiEmailBatches = pgTable(
  'ai_email_batches',
  {
    id: uuid().primaryKey(),
    runId: uuid().notNull(),
    taskId: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    projectId: uuid().notNull(),
    /** the batch comment: the executor answers in its thread */
    commentId: uuid().notNull(),
    /** who confirms with «ок» (fixed at insert; null — a batch from before 0058) */
    assigneeId: uuid(),
    /** pending | sending | sent | cancelled */
    state: text().notNull(),
    emails: jsonb().$type<AiEmail[]>().notNull(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    index('ai_email_batches_comment_id_idx').on(t.commentId),
    index('ai_email_batches_project_id_idx').on(t.projectId),
  ],
);

// server table: the instance switch of the AI (one row); no row — enabled
export const aiSettings = pgTable(
  'ai_settings',
  {
    id: integer().primaryKey().default(1),
    enabled: boolean().notNull().default(true),
  },
  (t) => [check('ai_settings_one_row', sql`${t.id} = 1`)],
);

// server table: daily limits of a project (UTC day); null — the env default applies
export const aiProjectLimits = pgTable('ai_project_limits', {
  projectId: uuid().primaryKey(),
  dailyTokens: integer(),
  dailyCost: doublePrecision(),
  /** most agent containers of the project running at once; null — only the instance limit */
  maxAgents: integer(),
  updatedAt: ts().notNull().defaultNow(),
});
