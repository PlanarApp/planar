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

/** Personal link "reply to an existing task": only the sha256 of the token is stored. Not synced. */
export const formsLinks = pgTable(
  'forms_links',
  {
    id: uuid().primaryKey(),
    formId: uuid().notNull(),
    taskId: uuid().notNull(),
    tokenHash: text().notNull().unique(),
    expiresAt: ts().notNull(),
    singleUse: boolean().notNull(),
    usedAt: ts(),
    createdBy: uuid().notNull(),
    createdAt: ts().notNull(),
  },
  (t) => [index('forms_links_form_id_idx').on(t.formId)],
);
