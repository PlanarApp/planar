import type { TaskField } from '../options';

/** Колонки Списка справа от названия — порядок и ширины общие для строк и заголовка (как в ClickUp). */
export const LIST_COLUMNS = ['assignee', 'dueDate', 'priority', 'labels'] as const;
export type ListColumn = (typeof LIST_COLUMNS)[number];
export const COLUMN_CLASS: Record<ListColumn, string> = {
  assignee: 'w-28',
  dueDate: 'w-28',
  priority: 'w-28',
  labels: 'w-40 max-lg:hidden',
};
export const visibleColumns = (fields: readonly TaskField[]): ListColumn[] =>
  LIST_COLUMNS.filter((c) => fields.includes(c));
