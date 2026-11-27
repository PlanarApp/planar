import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const ts = () => timestamp({ withTimezone: true, mode: 'string' });

// server table (not synced): the workspace's github.com connection with a personal token; at most one row
export const githubConnections = pgTable('github_connections', {
  id: uuid().primaryKey(),
  login: text().notNull(),
  // server-kit encrypt (PLANAR_SECRET_KEY), never returned by the API
  tokenEnc: text().notNull(),
  connectedBy: uuid().notNull(),
  createdAt: ts().notNull().defaultNow(),
});
