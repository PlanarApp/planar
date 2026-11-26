import { and, eq, sql } from 'drizzle-orm';
import { decrypt, secretKey, type Db } from '@planar/server-kit';
import { WORKSPACE_SCOPE_ID, type AiConnectionView, type AiProvider } from '../shared/index.js';
import type { LlmConnection } from './llm.js';
import { aiConnectionChoices as Ch, aiConnections as C } from './schema.js';

type Row = typeof C.$inferSelect;
/** A connection or a transaction. */
type Q = Pick<Db, 'select' | 'execute'>;

export const viewOf = (r: Row): AiConnectionView => ({
  id: r.id,
  scope: r.scope as AiConnectionView['scope'],
  scopeId: r.scopeId,
  provider: r.provider as AiProvider,
  baseUrl: r.baseUrl,
  model: r.model,
  priceIn: r.priceIn,
  priceOut: r.priceOut,
  keySet: true,
  updatedAt: new Date(r.updatedAt).toISOString(),
});

/**
 * The connection set on one level: its own, else the parent's one it chose (ai_connection_choices).
 * The workspace level is its default — the first (oldest) connection of the list.
 */
export async function levelConnection(
  q: Q,
  scope: 'project' | 'space' | 'workspace',
  scopeId: string,
): Promise<Row | null> {
  if (scope === 'workspace')
    return (
      (
        await q.select().from(C).where(eq(C.scope, 'workspace')).orderBy(C.createdAt, C.id).limit(1)
      )[0] ?? null
    );
  const own = (
    await q
      .select()
      .from(C)
      .where(and(eq(C.scope, scope), eq(C.scopeId, scopeId)))
  )[0];
  if (own) return own;
  const [ch] = await q
    .select({ c: C })
    .from(Ch)
    .innerJoin(C, eq(C.id, Ch.connectionId))
    .where(and(eq(Ch.scope, scope), eq(Ch.scopeId, scopeId)));
  return ch?.c ?? null;
}

/**
 * The connection in force for a project: the nearest level wins — project, then its space, then the workspace.
 * A chat channel without a project passes its own `spaceId` (null for the workspace level only).
 * null — nothing is configured on any level.
 */
export async function resolveConnection(
  q: Q,
  projectId: string | null,
  spaceId: string | null = null,
): Promise<Row | null> {
  let space = spaceId;
  if (projectId) {
    const own = await levelConnection(q, 'project', projectId);
    if (own) return own;
    const r = await q.execute(
      sql`select space_id as s from projects where id = ${projectId}::uuid`,
    );
    space = (r.rows[0]?.s as string | undefined) ?? spaceId;
  }
  return (
    (space && (await levelConnection(q, 'space', space))) ||
    levelConnection(q, 'workspace', WORKSPACE_SCOPE_ID)
  );
}

/**
 * A rule's models (`provider:model`, harness.yml) → the model for a connection: the first entry of the
 * connection's provider. null — none fits, the connection's default model stays.
 */
export function pickModel(models: readonly string[] | null | undefined, provider: string) {
  for (const m of models ?? []) {
    const i = m.indexOf(':');
    if (i > 0 && m.slice(0, i) === provider) return m.slice(i + 1);
  }
  return null;
}

/** Row → connection for a call: decrypts the key. Without PLANAR_SECRET_KEY or with a foreign key — throws. */
export function secretOf(r: Row): LlmConnection {
  const key = secretKey();
  if (!key) throw new Error('PLANAR_SECRET_KEY не задан');
  return {
    provider: r.provider as AiProvider,
    baseUrl: r.baseUrl,
    apiKey: decrypt(r.keyEnc, key),
    model: r.model,
    priceIn: r.priceIn,
    priceOut: r.priceOut,
  };
}
