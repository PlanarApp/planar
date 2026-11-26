import { isProjectAdmin, roleInProject, type Row } from '@planar/shared';
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

/** My role in a space or a project (by its id), the mutators' rule over the replica; null — none (or not loaded yet). */
export function useRoleIn() {
  const { user } = useAuth();
  const roles = useQuery(async () => {
    const me = user.value?.id;
    const out = new Map<string, 'admin' | 'member' | 'guest' | null>();
    if (!me) return out;
    const tx = new DexieTx(db);
    const [ps, ss] = await Promise.all([
      db.table<Row<'projects'>>('projects').toArray(),
      db.table<Row<'spaces'>>('spaces').toArray(),
    ]);
    for (const s of ss) out.set(s.id, await roleInProject(tx, s.id, null, me));
    for (const p of ps) out.set(p.id, await roleInProject(tx, p.spaceId, p.id, me));
    return out;
  });
  return (id: string) => roles.value?.get(id) ?? null;
}
