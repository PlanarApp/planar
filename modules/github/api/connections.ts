import { and, asc, eq, or, sql } from 'drizzle-orm';
import type { Db } from '@planar/server-kit';
import {
  WORKSPACE_SCOPE_ID,
  type GithubConnectionView,
  type GithubScope,
} from '../shared/index.js';
import { githubChoices as C, githubConnections as G } from './schema.js';

// PLNRAPP-890: levels of GitHub connections — the same rules as modules/gitlab/api/servers.ts

type Q = Pick<Db, 'select' | 'execute'>;
export type Connection = typeof G.$inferSelect;

export const viewOf = (r: Connection): GithubConnectionView => ({
  id: r.id,
  scope: r.scope as GithubScope,
  scopeId: r.scopeId,
  login: r.login,
  connectedBy: r.connectedBy,
  connectedAt: new Date(r.createdAt).toISOString(),
});

type Level = { scope: GithubScope; scopeId: string };

/** Levels from the nearest: [project,] [space,] workspace. A project's space is looked up. */
async function chainOf(q: Q, scope: GithubScope, scopeId: string): Promise<Level[]> {
  const chain: Level[] = [];
  let spaceId: string | null = scope === 'space' ? scopeId : null;
  if (scope === 'project') {
    chain.push({ scope, scopeId });
    const r = await q.execute(sql`select space_id as id from projects where id = ${scopeId}::uuid`);
    spaceId = (r.rows[0]?.id as string | undefined) ?? null;
  }
  if (spaceId) chain.push({ scope: 'space', scopeId: spaceId });
  chain.push({ scope: 'workspace', scopeId: WORKSPACE_SCOPE_ID });
  return chain;
}

/** Connections a level can choose: its own and those of the levels above. */
export async function availableConnections(q: Q, scope: GithubScope, scopeId: string) {
  const chain = await chainOf(q, scope, scopeId);
  return q
    .select()
    .from(G)
    .where(or(...chain.map((c) => and(eq(G.scope, c.scope), eq(G.scopeId, c.scopeId)))))
    .orderBy(asc(G.createdAt), asc(G.id));
}

/**
 * The connection in force for a level: the nearest level that made a choice wins (project, space, workspace);
 * nobody chose — the oldest workspace connection. null — no connection is configured.
 */
export async function resolveConnection(
  q: Q,
  scope: GithubScope,
  scopeId: string,
): Promise<Connection | null> {
  const chain = await chainOf(q, scope, scopeId);
  const rows = await q
    .select({ scope: C.scope, scopeId: C.scopeId, conn: G })
    .from(C)
    .innerJoin(G, eq(C.connectionId, G.id))
    .where(or(...chain.map((c) => and(eq(C.scope, c.scope), eq(C.scopeId, c.scopeId)))));
  for (const c of chain) {
    const hit = rows.find((r) => r.scope === c.scope && r.scopeId === c.scopeId);
    if (hit) return hit.conn;
  }
  const [def] = await q
    .select()
    .from(G)
    .where(and(eq(G.scope, 'workspace'), eq(G.scopeId, WORKSPACE_SCOPE_ID)))
    .orderBy(asc(G.createdAt), asc(G.id))
    .limit(1);
  return def ?? null;
}

/** The level's own choice (null — inherits). */
export async function choiceOf(q: Q, scope: GithubScope, scopeId: string): Promise<string | null> {
  const [r] = await q
    .select()
    .from(C)
    .where(and(eq(C.scope, scope), eq(C.scopeId, scopeId)));
  return r?.connectionId ?? null;
}
