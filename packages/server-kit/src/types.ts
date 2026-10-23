import type { NodePgDatabase, NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';

export type Db = NodePgDatabase<Record<string, unknown>>;
export type Q = PgDatabase<NodePgQueryResultHKT, Record<string, unknown>>;
