import type { SortBy } from '../tasks';

/** Click on a column header (as in ClickUp): ascending → descending → manual order again. */
export function nextSort(
  cur: { sortBy: SortBy; sortDir: 'asc' | 'desc' },
  by: SortBy,
): { sortBy: SortBy; sortDir: 'asc' | 'desc' } {
  if (cur.sortBy !== by) return { sortBy: by, sortDir: 'asc' };
  return cur.sortDir === 'asc'
    ? { sortBy: by, sortDir: 'desc' }
    : { sortBy: 'rank', sortDir: 'asc' };
}

/** current sort arrow at the header; '' — column is not sortable */
export const sortMark = (
  cur: { sortBy: SortBy; sortDir: 'asc' | 'desc' },
  by: SortBy | undefined,
) => (by && cur.sortBy === by ? (cur.sortDir === 'asc' ? '↑' : '↓') : '');
