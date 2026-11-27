import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = () => timestamp({ withTimezone: true, mode: 'string' });

// server table (not synced): a github.com connection (personal token) of a level: workspace / space / project,
// as gitlab_servers. scopeId of the workspace level is the nil uuid
export const githubConnections = pgTable(
  'github_connections',
  {
    id: uuid().primaryKey(),
    scope: text().notNull(),
    scopeId: uuid().notNull(),
    login: text().notNull(),
    // server-kit encrypt (PLANAR_SECRET_KEY), never returned by the API
    tokenEnc: text().notNull(),
    connectedBy: uuid().notNull(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index('github_connections_scope_idx').on(t.scope, t.scopeId)],
);

// server table: the connection a level chose (its own or of a parent level); no row — inherits (as gitlab_choices)
export const githubChoices = pgTable(
  'github_choices',
  {
    scope: text().notNull(),
    scopeId: uuid().notNull(),
    connectionId: uuid().notNull(),
  },
  (t) => [uniqueIndex('github_choices_uq').on(t.scope, t.scopeId)],
);
