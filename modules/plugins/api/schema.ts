import { boolean, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const ts = () => timestamp({ withTimezone: true, mode: 'string' });

export const pluginsPlugins = pgTable('plugins_plugins', {
  id: uuid().primaryKey(),
  name: text().notNull(),
  url: text().notNull(),
  origin: text().notNull(),
  permissions: jsonb().$type<{ read: string[]; write: string[] }>().notNull(),
  points: jsonb().$type<Record<string, { label: string } | null>>().notNull(),
  enabled: boolean().notNull(),
  createdBy: uuid().notNull(),
  createdAt: ts().notNull(),
  updatedAt: ts().notNull(),
});
