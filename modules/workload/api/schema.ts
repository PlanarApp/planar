import { index, integer, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const workloadCapacities = pgTable(
  'workload_capacities',
  {
    id: uuid().primaryKey(),
    spaceId: uuid().notNull(),
    userId: uuid().notNull(),
    hoursPerWeek: integer().notNull(),
    updatedBy: uuid().notNull(),
    updatedAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
  },
  (t) => [
    uniqueIndex('workload_capacities_space_user_uq').on(t.spaceId, t.userId),
    index('workload_capacities_space_id_idx').on(t.spaceId),
    index('workload_capacities_user_id_idx').on(t.userId),
  ],
);
