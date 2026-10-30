import {
  boolean,
  check,
  date,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// only for FK (a core table); not exported, drizzle-kit does not create it
const users = pgTable('users', { id: uuid().primaryKey() });
const ts = () => timestamp({ withTimezone: true, mode: 'string' });
const status = (name: string) => check(name, sql`status in ('sending','sent','failed','skipped')`);

// server tables (not synced)
export const emailConfig = pgTable('email_config', {
  id: text().primaryKey(),
  host: text().notNull(),
  port: integer().notNull(),
  secure: boolean().notNull().default(false),
  username: text(),
  passwordEnc: text(),
  fromAddress: text().notNull(),
  updatedAt: ts().notNull().defaultNow(),
});

// FK to users — in the SQL migrations (modules do not import the core schema)
export const emailOutbox = pgTable(
  'email_outbox',
  {
    notificationId: uuid().primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text().notNull(),
    error: text(),
    createdAt: ts().notNull().defaultNow(),
    sentAt: ts(),
  },
  () => [status('email_outbox_status_check')],
);

export const emailDigests = pgTable(
  'email_digests',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    date: date({ mode: 'string' }).notNull(),
    status: text().notNull(),
    error: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.date] }), status('email_digests_status_check')],
);

// sync entity
export const emailPrefs = pgTable('email_prefs', {
  id: uuid().primaryKey(),
  userId: uuid().notNull(),
  notify: boolean().notNull(),
  digest: boolean().notNull(),
  updatedAt: ts().notNull(),
});
