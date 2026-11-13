import { sql } from 'drizzle-orm';
import {
  bigserial,
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
    /** workspace | space | project */
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
    /** event → action key (AI_EVENTS); null — not chosen yet: the apply takes `events` of harness.yml */
    events: jsonb().$type<Record<string, string>>(),
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
    // PLNRAPP-202: the indicator of the AI's work on a task and its items (comment, checklist item)
    index('ai_runs_task_id_item_id_state_idx').on(t.taskId, t.itemId, t.state),
    index('ai_runs_project_id_created_at_idx').on(t.projectId, t.createdAt),
    index('ai_runs_created_at_idx').on(t.createdAt),
  ],
);

// server table: the agent's log of a run (PLNRAPP-199) — events from the container, masked and shortened by the api;
// only the tail is kept (AGENT_LOG_MAX_EVENTS per run, agent-log.ts)
export const aiRunEvents = pgTable(
  'ai_run_events',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    runId: uuid()
      .notNull()
      .references(() => aiRuns.id, { onDelete: 'cascade' }),
    /** thought | tool_call | command | output | result */
    type: text().notNull(),
    tool: text(),
    text: text().notNull(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index('ai_run_events_run_id_id_idx').on(t.runId, t.id)],
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

// server table: harness-retro of a project (PLNRAPP-178); no row — on, with the defaults
export const aiRetro = pgTable('ai_retro', {
  projectId: uuid().primaryKey(),
  enabled: boolean().notNull().default(true),
  /** the retro runs once this many frictions came since the last one */
  everyFrictions: integer().notNull().default(5),
  /** …or this many days after the last one (cron), if there are open items */
  everyDays: integer().notNull().default(7),
  /** the task «harness-retro»: its subtasks are the items and the proposals */
  taskId: uuid(),
  /** frictions since the last retro */
  frictions: integer().notNull().default(0),
  lastRunAt: ts(),
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts().notNull().defaultNow(),
});

// server table: a proposal of the retro — an edit of an instruction of the active pack, a subtask in «Уточнение»
// assigned to the admin; the admin's answer in the thread of `commentId` decides (apply / close / redo)
export const aiRetroProposals = pgTable(
  'ai_retro_proposals',
  {
    id: uuid().primaryKey(),
    projectId: uuid().notNull(),
    /** the proposal subtask */
    taskId: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    /** the comment with the diff: the answer comes in its thread */
    commentId: uuid().notNull(),
    assigneeId: uuid(),
    /** the instruction edited: the action key; a new action — the key it gets */
    actionKey: text().notNull(),
    /** the instruction page; null — a new action */
    pageId: uuid(),
    /** the prompt the diff was made against */
    base: text().notNull(),
    prompt: text().notNull(),
    /** a new action: its name, description and a rule (YAML of one item of `rules`) */
    newAction: jsonb().$type<RetroNewAction>(),
    title: text().notNull(),
    /** the items the proposal covers: closed with it */
    items: uuid().array().notNull().default([]),
    /** pending | applied | closed */
    state: text().notNull(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    index('ai_retro_proposals_project_id_idx').on(t.projectId),
    index('ai_retro_proposals_comment_id_idx').on(t.commentId),
  ],
);

export type RetroNewAction = { name: string; description: string | null; rule: string | null };
