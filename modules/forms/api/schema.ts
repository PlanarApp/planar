import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = () => timestamp({ withTimezone: true, mode: 'string' });

export const formsForms = pgTable(
  'forms_forms',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    projectId: uuid().notNull(),
    slug: text().notNull().unique(),
    title: text().notNull(),
    description: text(),
    fields: jsonb().notNull(),
    statusId: uuid().notNull(),
    enabled: boolean().notNull(),
    createdBy: uuid().notNull(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [
    index('forms_forms_space_id_idx').on(t.spaceId),
    index('forms_forms_project_id_idx').on(t.projectId),
  ],
);

/** Submission limit per IP: keys `<ip>|m` and `<ip>|h`. */
export const formsRateLimits = pgTable('forms_rate_limits', {
  key: text().primaryKey(),
  count: integer().notNull(),
  windowStartedAt: ts().notNull(),
});
