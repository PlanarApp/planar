import { sql } from 'drizzle-orm';
import {
  check,
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

export type RowNote = { row: number; reason: string };
export type RowWarning = { row: number; message: string };

// source и mapping — служебные колонки сверх контракта: файл и сопоставление для задачи import.run; наружу не отдаются
export const importJobs = pgTable(
  'import_jobs',
  {
    id: uuid().primaryKey(),
    userId: uuid().notNull(),
    projectId: uuid().notNull(),
    format: text().notNull(),
    preset: text().notNull(),
    status: text().notNull().default('pending'),
    total: integer().notNull().default(0),
    processed: integer().notNull().default(0),
    created: integer().notNull().default(0),
    updated: integer().notNull().default(0),
    skipped: jsonb().$type<RowNote[]>().notNull().default([]),
    warnings: jsonb().$type<RowWarning[]>().notNull().default([]),
    error: text(),
    source: text(),
    mapping: jsonb().$type<Record<string, unknown>>(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    index('import_jobs_user_id_idx').on(t.userId),
    check('import_jobs_format_check', sql`${t.format} in ('csv', 'trello')`),
    check('import_jobs_status_check', sql`${t.status} in ('pending', 'running', 'done', 'failed')`),
  ],
);

export const importItems = pgTable(
  'import_items',
  {
    projectId: uuid().notNull(),
    preset: text().notNull(),
    externalId: text().notNull(),
    taskId: uuid().notNull(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.preset, t.externalId] })],
);
