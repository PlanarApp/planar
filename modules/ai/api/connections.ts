import { eq, sql } from 'drizzle-orm';
import { decrypt, secretKey, type Db } from '@planar/server-kit';
import { INSTANCE_SCOPE_ID, type AiConnectionView, type AiProvider } from '../shared/index.js';
import type { LlmConnection } from './llm.js';
import { aiConnections as C } from './schema.js';

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
 * The connection in force for a project: the nearest level wins — project, then its space, then the instance.
 * A chat channel without a project passes its own `spaceId` (null for the instance level only).
 * null — nothing is configured on any level.
 */
export async function resolveConnection(
  q: Q,
  projectId: string | null,
  spaceId: string | null = null,
): Promise<Row | null> {
  const r = await q.execute(sql`
    select c.id from ai_connections c
    where (c.scope = 'project' and c.scope_id = ${projectId}::uuid)
       or (c.scope = 'space' and c.scope_id = coalesce((select space_id from projects where id = ${projectId}::uuid), ${spaceId}::uuid))
       or (c.scope = 'instance' and c.scope_id = ${INSTANCE_SCOPE_ID}::uuid)
    order by case c.scope when 'project' then 0 when 'space' then 1 else 2 end
    limit 1`);
  const id = r.rows[0]?.id as string | undefined;
  return id ? ((await q.select().from(C).where(eq(C.id, id)))[0] ?? null) : null;
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
