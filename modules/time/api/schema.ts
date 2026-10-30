import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = () => timestamp({ withTimezone: true, mode: 'string' });

export const timeEntries = pgTable(
  'time_entries',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    taskId: uuid().notNull(),
    userId: uuid().notNull(),
    startedAt: ts().notNull(),
    endedAt: ts(),
    durationSec: integer(),
    note: text(),
    source: text().notNull(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [
    index('time_entries_space_id_idx').on(t.spaceId),
    index('time_entries_task_id_idx').on(t.taskId),
    index('time_entries_user_id_idx').on(t.userId),
    // one running timer per user
    uniqueIndex('time_entries_running_uq')
      .on(t.userId)
      .where(sql`${t.endedAt} is null`),
  ],
);

export const timeEstimates = pgTable(
  'time_estimates',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    taskId: uuid().notNull(),
    minutes: integer().notNull(),
    updatedBy: uuid().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [index('time_estimates_task_id_idx').on(t.taskId)],
);
