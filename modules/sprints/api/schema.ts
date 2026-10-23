import {
  boolean,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = () => timestamp({ withTimezone: true, mode: 'string' });

export const sprintsSettings = pgTable(
  'sprints_settings',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    projectId: uuid().notNull(),
    enabled: boolean().notNull(),
    lengthDays: integer().notNull(),
    timezone: text().notNull(),
    autoCreate: boolean().notNull(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [index('sprints_settings_project_id_idx').on(t.projectId)],
);

export const sprintsCycles = pgTable(
  'sprints_cycles',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    projectId: uuid().notNull(),
    number: integer().notNull(),
    name: text(),
    startDate: date({ mode: 'string' }).notNull(),
    endDate: date({ mode: 'string' }).notNull(),
    closedAt: ts(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [
    index('sprints_cycles_space_id_idx').on(t.spaceId),
    index('sprints_cycles_project_id_idx').on(t.projectId),
    uniqueIndex('sprints_cycles_project_number_uq').on(t.projectId, t.number),
  ],
);
