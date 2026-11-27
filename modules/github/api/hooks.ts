import { and, eq } from 'drizzle-orm';
import type { ModuleHookApi, MutationWrite } from '@planar/server-kit';
import { githubChoices as C, githubConnections as G } from './schema.js';

/** The level is gone: its own connections and its choice go too (as modules/gitlab). */
async function dropLevel(api: ModuleHookApi, scope: string, id: string) {
  await api.q.delete(C).where(and(eq(C.scope, scope), eq(C.scopeId, id)));
  const own = await api.q
    .delete(G)
    .where(and(eq(G.scope, scope), eq(G.scopeId, id)))
    .returning({ id: G.id });
  // levels below that chose a connection of the deleted level fall back to inheriting
  for (const r of own) await api.q.delete(C).where(eq(C.connectionId, r.id));
}

/** Deleting a project / space takes its GitHub connections and choice with it. */
export async function afterMutation(writes: MutationWrite[], _ctx: unknown, api: ModuleHookApi) {
  for (const w of writes) {
    if (w.op !== 'del' || !w.before) continue;
    if (w.entity === 'projects') await dropLevel(api, 'project', w.before.id as string);
    else if (w.entity === 'spaces') await dropLevel(api, 'space', w.before.id as string);
  }
}
