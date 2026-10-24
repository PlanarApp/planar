import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const ts = () => timestamp({ withTimezone: true, mode: 'string' });

export const dashboardsBoards = pgTable(
  'dashboards_boards',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    userId: uuid(),
    name: text().notNull(),
    rank: text().notNull(),
    createdBy: uuid().notNull(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [
    index('dashboards_boards_space_id_idx').on(t.spaceId),
    index('dashboards_boards_user_id_idx').on(t.userId),
  ],
);

export const dashboardsWidgets = pgTable(
  'dashboards_widgets',
  {
    id: uuid().primaryKey(),
    dashboardId: uuid().notNull(),
    spaceId: uuid().notNull(),
    userId: uuid(),
    kind: text().notNull(),
    title: text(),
    config: jsonb().$type<Record<string, unknown>>().notNull(),
    x: integer().notNull(),
    y: integer().notNull(),
    w: integer().notNull(),
    h: integer().notNull(),
    createdAt: ts().notNull(),
    updatedAt: ts().notNull(),
  },
  (t) => [index('dashboards_widgets_dashboard_id_idx').on(t.dashboardId)],
);
