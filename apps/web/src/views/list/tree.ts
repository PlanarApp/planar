/**
 * Subtasks under the parent (as in ClickUp): the group order is a tree, sorted at each level
 * in the order of the input array. A task whose parent is not in this set goes to the top level.
 */
export function treeOrder<T extends { id: string; parentId: string | null }>(
  tasks: readonly T[],
): { task: T; depth: number }[] {
  const ids = new Set(tasks.map((t) => t.id));
  const kids = new Map<string, T[]>();
  const roots: T[] = [];
  for (const t of tasks) {
    if (t.parentId && t.parentId !== t.id && ids.has(t.parentId)) {
      const list = kids.get(t.parentId);
      if (list) list.push(t);
      else kids.set(t.parentId, [t]);
    } else roots.push(t);
  }
  const out: { task: T; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (t: T, depth: number) => {
    if (seen.has(t.id)) return; // a cycle in parentId data — don't loop forever
    seen.add(t.id);
    out.push({ task: t, depth });
    for (const c of kids.get(t.id) ?? []) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  // only tasks from a cycle remain (A→B→A): show them at the top level
  for (const t of tasks) walk(t, 0);
  return out;
}
