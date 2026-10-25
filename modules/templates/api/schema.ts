import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const ts = () => timestamp({ withTimezone: true, mode: 'string' });

export const templatesTemplates = pgTable(
  'templates_templates',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    kind: text().notNull(),
    name: text().notNull(),
    description: text(),
    data: jsonb().$type<unknown>().notNull(),
    createdBy: uuid().notNull(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [index('templates_templates_space_id_idx').on(t.spaceId)],
);
