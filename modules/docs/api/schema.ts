import { customType, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const rank = customType<{ data: string }>({ dataType: () => 'text COLLATE "C"' });
const ts = () => timestamp({ withTimezone: true, mode: 'string' });

export const docsPages = pgTable(
  'docs_pages',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    parentId: uuid(),
    rank: rank().notNull(),
    title: text().notNull(),
    icon: text(),
    body: jsonb().$type<Record<string, unknown>>().notNull(),
    text: text().notNull(),
    files: jsonb().$type<string[]>().notNull(),
    createdBy: uuid().notNull(),
    updatedBy: uuid().notNull(),
    archivedAt: ts(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [index('docs_pages_space_id_idx').on(t.spaceId), index('docs_pages_parent_id_idx').on(t.parentId)],
);

export const docsTaskLinks = pgTable(
  'docs_task_links',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    pageId: uuid().notNull(),
    taskId: uuid().notNull(),
    createdBy: uuid().notNull(),
    createdAt: ts().notNull(),
  },
  (t) => [
    uniqueIndex('docs_task_links_page_task_uq').on(t.pageId, t.taskId),
    index('docs_task_links_space_id_idx').on(t.spaceId),
    index('docs_task_links_page_id_idx').on(t.pageId),
    index('docs_task_links_task_id_idx').on(t.taskId),
  ],
);

export const docsLocks = pgTable('docs_locks', {
  id: uuid().primaryKey(),
  spaceId: uuid().notNull(),
  userId: uuid().notNull(),
  expiresAt: ts().notNull(),
});
