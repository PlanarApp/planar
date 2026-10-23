import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const helloNotes = pgTable(
  'hello_notes',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    text: text().notNull(),
    createdAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
  },
  (t) => [index('hello_notes_space_id_idx').on(t.spaceId)],
);
