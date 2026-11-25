import { and, asc, eq, getTableColumns, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '@planar/server-kit';
import { WORKSPACE_SCOPE_ID, type GitlabScope, type GitlabServerView } from '../shared/index.js';
import { gitlabChoices as C, gitlabConnections as P, gitlabServers as S } from './schema.js';

type Q = Pick<Db, 'select' | 'execute'>;
export type Server = typeof S.$inferSelect;
/** A repository binding with the host and token of its connection. */
export type Binding = typeof P.$inferSelect & { baseUrl: string; tokenEnc: string };

export const viewOf = (r: Server): GitlabServerView => ({
  id: r.id,
  scope: r.scope as GitlabScope,
  scopeId: r.scopeId,
  name: r.name,
  baseUrl: r.baseUrl,
  tokenSet: true,
});

/** The bindings (all, or by condition) joined with their connection. */
export const bindingsOf = (q: Q, where?: SQL): Promise<Binding[]> =>
  q
    .select({ ...getTableColumns(P), baseUrl: S.baseUrl, tokenEnc: S.tokenEnc })
    .from(P)
    .innerJoin(S, eq(P.serverId, S.id))
    .where(where)
    .orderBy(P.createdAt, P.id);

type Level = { scope: GitlabScope; scopeId: string };

/** Levels from the nearest: [project,] [space,] workspace. A project's space is looked up. */
async function chainOf(q: Q, scope: GitlabScope, scopeId: string): Promise<Level[]> {
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
export async function availableServers(q: Q, scope: GitlabScope, scopeId: string) {
  const chain = await chainOf(q, scope, scopeId);
  return q
    .select()
    .from(S)
    .where(or(...chain.map((c) => and(eq(S.scope, c.scope), eq(S.scopeId, c.scopeId)))))
    .orderBy(asc(S.createdAt), asc(S.id));
}

/**
 * The connection in force for a level: the nearest level that made a choice wins (project, space, workspace);
 * nobody chose — the oldest workspace connection. null — no connection is configured.
 */
export async function resolveServer(
  q: Q,
  scope: GitlabScope,
  scopeId: string,
): Promise<Server | null> {
  const chain = await chainOf(q, scope, scopeId);
  const rows = await q
    .select({ scope: C.scope, scopeId: C.scopeId, server: S })
    .from(C)
    .innerJoin(S, eq(C.serverId, S.id))
    .where(or(...chain.map((c) => and(eq(C.scope, c.scope), eq(C.scopeId, c.scopeId)))));
  for (const c of chain) {
    const hit = rows.find((r) => r.scope === c.scope && r.scopeId === c.scopeId);
    if (hit) return hit.server;
  }
  const [def] = await q
    .select()
    .from(S)
    .where(and(eq(S.scope, 'workspace'), eq(S.scopeId, WORKSPACE_SCOPE_ID)))
    .orderBy(asc(S.createdAt), asc(S.id))
    .limit(1);
  return def ?? null;
}

/** The level's own choice (null — inherits). */
export async function choiceOf(q: Q, scope: GitlabScope, scopeId: string): Promise<string | null> {
  const [r] = await q
    .select()
    .from(C)
    .where(and(eq(C.scope, scope), eq(C.scopeId, scopeId)));
  return r?.serverId ?? null;
}
