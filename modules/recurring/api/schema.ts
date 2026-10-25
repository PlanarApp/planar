import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  date,
} from 'drizzle-orm/pg-core';

const ts = () => timestamp({ withTimezone: true, mode: 'string' });

export const recurringRules = pgTable(
  'recurring_rules',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    taskId: uuid().notNull(),
    kind: text().notNull(),
    every: integer().notNull(),
    unit: text().notNull(),
    weekdays: jsonb().notNull(),
    anchorDate: date({ mode: 'string' }).notNull(),
    nextDate: date({ mode: 'string' }),
    timezone: text().notNull(),
    createdBy: uuid().notNull(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [
    index('recurring_rules_space_id_idx').on(t.spaceId),
    uniqueIndex('recurring_rules_task_id_uq').on(t.taskId),
  ],
);

/** Серверная: один экземпляр на (правило, период). */
export const recurringRuns = pgTable(
  'recurring_runs',
  {
    ruleId: uuid().notNull(),
    period: text().notNull(),
    taskId: uuid().notNull(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ruleId, t.period] })],
);
