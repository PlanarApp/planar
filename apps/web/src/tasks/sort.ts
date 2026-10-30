import type { TaskView } from './queries';

export type SortBy =
  'rank' | 'priority' | 'dueDate' | 'startDate' | 'createdAt' | 'updatedAt' | 'title';

// priority 0 ("none") counts as an empty value and goes to the end in either direction
const val = (t: TaskView, by: SortBy): string | number | null =>
  by === 'priority' ? t.priority || null : (t[by] ?? null);

export function sortTasks(tasks: TaskView[], by: SortBy, dir: 'asc' | 'desc'): TaskView[] {
  const s = dir === 'asc' ? 1 : -1;
  return tasks.slice().sort((a, b) => {
    const x = val(a, by);
    const y = val(b, by);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    if (by === 'title') return s * String(x).localeCompare(String(y));
    return x < y ? -s : x > y ? s : 0;
  });
}
