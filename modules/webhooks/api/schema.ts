import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const ts = () => timestamp({ withTimezone: true, mode: 'string' });

export const webhooksSubscriptions = pgTable('webhooks_subscriptions', {
  id: uuid().primaryKey(),
  url: text().notNull(),
  events: text().array().notNull(),
  secret: text().notNull(),
  active: boolean().notNull(),
  description: text(),
  createdBy: uuid().notNull(),
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts().notNull().defaultNow(),
});

export const webhooksDeliveries = pgTable(
  'webhooks_deliveries',
  {
    id: uuid().primaryKey(),
    subscriptionId: uuid()
      .notNull()
      .references(() => webhooksSubscriptions.id, { onDelete: 'cascade' }),
    event: text().notNull(),
    // the data of the body; the body {id, event, createdAt, data} is assembled on every attempt
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    status: text().notNull(),
    attempts: integer().notNull().default(0),
    // the moment of the next attempt (when attempted — the lease); null for completed ones
    nextAttemptAt: ts(),
    lastStatus: integer(),
    lastError: text(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    index('webhooks_deliveries_sub_created_idx').on(t.subscriptionId, t.createdAt.desc()),
    check('webhooks_deliveries_status_chk', sql`${t.status} in ('pending', 'ok', 'failed')`),
  ],
);
