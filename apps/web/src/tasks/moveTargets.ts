import { computed, type Ref } from 'vue';
import { FolderKanban, LayoutGrid } from '@lucide/vue';
import type { Row } from '@planar/shared';
import type { SubItem } from '../ui/Menu.vue';
import NodeGlyph from '../ui/NodeGlyph.vue';
import { useAuth } from '../auth/useAuth';
import { db, useQuery } from '../sync';
import { useRootSpaceId } from './queries';

/** A space of the "Move to project" menu: `writable` — the space itself (a docs page without a project). */
export interface MoveSpace {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  writable: boolean;
  projects: { id: string; name: string; icon?: string | null; color?: string | null }[];
}

type Role = 'admin' | 'member' | 'guest' | null;

const byRank = <T extends { rank: string }>(a: T, b: T) =>
  a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;

/**
 * PLNRAPP-519: spaces and projects the user can change, in the sidebar order (the root space first,
 * then by rank; live projects by rank). The project role is the SQL rule `project_role` (PJ-11):
 * instance and space admins — admin; `inherit` — the space role; `custom` — the project role, a space
 * guest is a guest at most. Writable — admin or member. Spaces without writable projects or own write
 * access drop out.
 */
export function moveSpaces(d: {
  me: { id: string; role: string } | null;
  rootId: string | null;
  spaces: Row<'spaces'>[];
  projects: Row<'projects'>[];
  spaceMembers: Row<'spaceMembers'>[];
  projectMembers: Row<'projectMembers'>[];
}): MoveSpace[] {
  const me = d.me;
  if (!me) return [];
  const boss = me.role === 'owner' || me.role === 'admin';
  const spaceRole = new Map(
    d.spaceMembers.filter((m) => m.userId === me.id).map((m) => [m.spaceId, m.role]),
  );
  const projectRole = new Map(
    d.projectMembers.filter((m) => m.userId === me.id).map((m) => [m.projectId, m.role]),
  );
  const roleIn = (p: Row<'projects'>): Role => {
    if (boss) return 'admin';
    const sr = spaceRole.get(p.spaceId);
    if (!sr) return null;
    if (sr === 'admin' || p.membersMode !== 'custom') return sr;
    const pr = projectRole.get(p.id);
    if (!pr) return null;
    return sr === 'guest' ? 'guest' : pr;
  };
  const canWrite = (r: Role | undefined) => r === 'admin' || r === 'member';
  const live = d.projects.filter((p) => !p.archivedAt).sort(byRank);
  return [...d.spaces]
    .sort((a, b) => (a.id === d.rootId ? -1 : b.id === d.rootId ? 1 : byRank(a, b)))
    .map((s) => ({
      id: s.id,
      name: s.name,
      icon: s.icon,
      color: s.color,
      writable: boss || canWrite(spaceRole.get(s.id)),
      projects: live
        .filter((p) => p.spaceId === s.id && canWrite(roleIn(p)))
        .map((p) => ({ id: p.id, name: p.name, icon: p.icon, color: p.color })),
    }))
    .filter((s) => s.projects.length > 0 || s.writable);
}

/** Reactive moveSpaces over the replica. */
export function useMoveSpaces(): Readonly<Ref<MoveSpace[]>> {
  const user = useAuth().user;
  const rootId = useRootSpaceId();
  const rows = useQuery(async () => {
    const [spaces, projects, spaceMembers, projectMembers] = await Promise.all([
      db.table<Row<'spaces'>>('spaces').toArray(),
      db.table<Row<'projects'>>('projects').toArray(),
      db.table<Row<'spaceMembers'>>('spaceMembers').toArray(),
      db.table<Row<'projectMembers'>>('projectMembers').toArray(),
    ]);
    return { spaces, projects, spaceMembers, projectMembers };
  });
  return computed(() =>
    rows.value
      ? moveSpaces({
          ...rows.value,
          me: user.value ? { id: user.value.id, role: user.value.role } : null,
          rootId: rootId.value ?? null,
        })
      : [],
  );
}

/**
 * Items of the "Move to project" submenu: spaces → their projects; the current space and project are
 * checked, picking the current place does nothing. `noProject` — the label of the space-itself item
 * (docs pages), first in a writable space. `count` — how many places there are (the menu is disabled
 * when only the current one is left).
 */
export function moveMenu(
  spaces: readonly MoveSpace[],
  at: { spaceId: string; projectId: string | null },
  pick: (spaceId: string, projectId: string | null) => void,
  noProject?: string,
): { items: SubItem[]; count: number } {
  let count = 0;
  const items = spaces
    .map((s) => {
      const places: {
        id: string | null;
        name: string;
        icon?: string | null;
        color?: string | null;
      }[] = [...(noProject && s.writable ? [{ id: null, name: noProject }] : []), ...s.projects];
      count += places.length;
      return {
        id: s.id,
        label: s.name,
        icon: NodeGlyph,
        iconProps: { icon: s.icon, color: s.color, fallback: LayoutGrid },
        checked: s.id === at.spaceId,
        children: places.map((p) => {
          const here = s.id === at.spaceId && p.id === at.projectId;
          return {
            id: p.id ?? `${s.id}:none`,
            label: p.name,
            ...(p.id && {
              icon: NodeGlyph,
              iconProps: { icon: p.icon, color: p.color, fallback: FolderKanban },
            }),
            checked: here,
            onSelect: () => here || pick(s.id, p.id),
          };
        }),
      };
    })
    .filter((s) => s.children.length > 0);
  return { items, count };
}
