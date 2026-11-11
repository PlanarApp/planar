import { isProjectAdmin, type Row } from '@planar/shared';
import { useAuth } from '../auth/useAuth';
import { db, useQuery } from '../sync';
import { DexieTx } from '../sync/dexie-tx';

/** Admin of the project (projectId null — of the space): the mutators' rule over the replica (PLNRAPP-154/155). */
export const canAdmin = (userId: string, spaceId: string, projectId: string | null) =>
  isProjectAdmin(new DexieTx(db), spaceId, projectId, userId);

/** Reactive canAdmin for menus: ids of the projects and spaces I administer. */
export function useProjectAdmin() {
  const { user } = useAuth();
  const ids = useQuery(async () => {
    const me = user.value?.id;
    const out = new Set<string>();
    if (!me) return out;
    const [ps, ss] = await Promise.all([
      db.table<Row<'projects'>>('projects').toArray(),
      db.table<Row<'spaces'>>('spaces').toArray(),
    ]);
    for (const s of ss) if (await canAdmin(me, s.id, null)) out.add(s.id);
    for (const p of ps)
      if (out.has(p.spaceId) || (await canAdmin(me, p.spaceId, p.id))) out.add(p.id);
    return out;
  });
  return (spaceId: string, projectId: string | null): boolean =>
    !!ids.value?.has(projectId ?? spaceId);
}
