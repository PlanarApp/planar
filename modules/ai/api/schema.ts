import { doublePrecision, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const ts = () => timestamp({ withTimezone: true, mode: 'string' });

// server table (not synced, outside the module gate): a connection to an AI provider per level;
// the nearest level wins: project → space → instance. The key is only encrypted (keyEnc), never returned.
export const aiConnections = pgTable(
  'ai_connections',
  {
    id: uuid().primaryKey(),
    /** instance | space | project */
    scope: text().notNull(),
    /** space or project id; the nil uuid for the instance */
    scopeId: uuid().notNull(),
    /** openai | anthropic | openai-compatible */
    provider: text().notNull(),
    baseUrl: text(),
    keyEnc: text().notNull(),
    model: text().notNull(),
    /** USD per 1M tokens */
    priceIn: doublePrecision(),
    priceOut: doublePrecision(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ai_connections_scope_uq').on(t.scope, t.scopeId)],
);
