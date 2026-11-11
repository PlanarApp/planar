import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = () => timestamp({ withTimezone: true, mode: 'string' });

export const automationsRules = pgTable(
  'automations_rules',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    projectId: uuid().notNull(),
    name: text().notNull(),
    description: text(),
    enabled: boolean().notNull(),
    trigger: jsonb().$type<unknown>().notNull(),
    conditions: jsonb().$type<unknown>().notNull(),
    actions: jsonb().$type<unknown>().notNull(),
    createdBy: uuid().notNull(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [
    index('automations_rules_space_id_idx').on(t.spaceId),
    index('automations_rules_project_id_idx').on(t.projectId),
  ],
);

export const automationsRuns = pgTable(
  'automations_runs',
  {
    id: uuid().primaryKey(),
    ruleId: uuid().notNull(),
    taskId: uuid().notNull(),
    depth: integer().notNull(),
    status: text().notNull(),
    error: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [
    index('automations_runs_rule_idx').on(t.ruleId, t.createdAt.desc()),
    check('automations_runs_status_check', sql`${t.status} in ('ok', 'skipped', 'error')`),
  ],
);

export const automationsDueFired = pgTable(
  'automations_due_fired',
  {
    ruleId: uuid().notNull(),
    taskId: uuid().notNull(),
    dueDate: date({ mode: 'string' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.ruleId, t.taskId, t.dueDate] })],
);

/** Scanned triggers fire once per (rule, task, slot); slot — the moment the condition is counted from. */
export const automationsFired = pgTable(
  'automations_fired',
  {
    ruleId: uuid().notNull(),
    taskId: uuid().notNull(),
    slot: text().notNull(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ruleId, t.taskId, t.slot] })],
);
