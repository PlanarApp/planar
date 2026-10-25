/**
 * Подзадачи под родителем (как в ClickUp): порядок группы — дерево, отсортированное на каждом уровне
 * в порядке входного массива. Задача, чей родитель не в этом наборе, — на верхнем уровне.
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
    if (seen.has(t.id)) return; // цикл в данных parentId — не зацикливаемся
    seen.add(t.id);
    out.push({ task: t, depth });
    for (const c of kids.get(t.id) ?? []) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  // остались только задачи из цикла (A→B→A): показываем на верхнем уровне
  for (const t of tasks) walk(t, 0);
  return out;
}
