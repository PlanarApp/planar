import type { TaskField } from '../options';

/** List columns right of the name — order and widths are shared by rows and header (as in ClickUp). */
export const LIST_COLUMNS = [
  'project',
  'assignee',
  'dueDate',
  'priority',
  'labels',
  'ai',
  'aiCost',
  'aiTime',
] as const;
export type ListColumn = (typeof LIST_COLUMNS)[number];
/** widths — auto-size and manual (widths.ts); here only hiding on narrow screens */
// on phones — only the name: auto-size columns would otherwise shrink it to zero
export const COLUMN_CLASS: Record<ListColumn, string> = {
  project: 'max-md:hidden',
  assignee: 'max-md:hidden',
  dueDate: 'max-md:hidden',
  priority: 'max-md:hidden',
  labels: 'max-lg:hidden',
  ai: 'max-md:hidden',
  aiCost: 'max-md:hidden',
  aiTime: 'max-md:hidden',
};
export const visibleColumns = (fields: readonly TaskField[]): ListColumn[] =>
  LIST_COLUMNS.filter((c) => fields.includes(c));
/**
 * PLNRAPP-705: narrow list area — order of the second row: parent (order-3), labels, assignees,
 * dates, the remaining columns, icons (progress, module fields — order-8) last.
 */
export const NARROW_ORDER: Record<ListColumn, string> = {
  labels: '@max-[720px]/list:order-4',
  assignee: '@max-[720px]/list:order-5',
  dueDate: '@max-[720px]/list:order-6',
  project: '@max-[720px]/list:order-7',
  priority: '@max-[720px]/list:order-7',
  ai: '@max-[720px]/list:order-7',
  aiCost: '@max-[720px]/list:order-7',
  aiTime: '@max-[720px]/list:order-7',
};
