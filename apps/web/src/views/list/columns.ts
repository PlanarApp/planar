import type { TaskField } from '../options';

/** List columns right of the name — order and widths are shared by rows and header (as in ClickUp). */
export const LIST_COLUMNS = ['project', 'assignee', 'dueDate', 'priority', 'labels'] as const;
export type ListColumn = (typeof LIST_COLUMNS)[number];
/** widths — auto-size and manual (widths.ts); here only hiding on narrow screens */
// on phones — only the name: auto-size columns would otherwise shrink it to zero
export const COLUMN_CLASS: Record<ListColumn, string> = {
  project: 'max-md:hidden',
  assignee: 'max-md:hidden',
  dueDate: 'max-md:hidden',
  priority: 'max-md:hidden',
  labels: 'max-lg:hidden',
};
export const visibleColumns = (fields: readonly TaskField[]): ListColumn[] =>
  LIST_COLUMNS.filter((c) => fields.includes(c));
