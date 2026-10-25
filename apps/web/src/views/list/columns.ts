import type { TaskField } from '../options';

/** Колонки Списка справа от названия — порядок и ширины общие для строк и заголовка (как в ClickUp). */
export const LIST_COLUMNS = ['project', 'assignee', 'dueDate', 'priority', 'labels'] as const;
export type ListColumn = (typeof LIST_COLUMNS)[number];
/** ширины — авторазмер и ручные (widths.ts); здесь — только скрытие на узких экранах */
export const COLUMN_CLASS: Record<ListColumn, string> = {
  project: 'max-md:hidden',
  assignee: '',
  dueDate: '',
  priority: '',
  labels: 'max-lg:hidden',
};
export const visibleColumns = (fields: readonly TaskField[]): ListColumn[] =>
  LIST_COLUMNS.filter((c) => fields.includes(c));
