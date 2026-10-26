import type { SortBy } from '../tasks';

/** Клик по заголовку колонки (как в ClickUp): по возрастанию → по убыванию → снова ручной порядок. */
export function nextSort(
  cur: { sortBy: SortBy; sortDir: 'asc' | 'desc' },
  by: SortBy,
): { sortBy: SortBy; sortDir: 'asc' | 'desc' } {
  if (cur.sortBy !== by) return { sortBy: by, sortDir: 'asc' };
  return cur.sortDir === 'asc'
    ? { sortBy: by, sortDir: 'desc' }
    : { sortBy: 'rank', sortDir: 'asc' };
}

/** стрелка текущей сортировки у заголовка; '' — колонка не сортирует */
export const sortMark = (
  cur: { sortBy: SortBy; sortDir: 'asc' | 'desc' },
  by: SortBy | undefined,
) => (by && cur.sortBy === by ? (cur.sortDir === 'asc' ? '↑' : '↓') : '');
