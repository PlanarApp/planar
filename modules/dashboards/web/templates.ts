import type { Filter, FilterRule } from '@planar/shared';
import type { WidgetKind } from '../shared/index.js';

type Text = { ru: string; en: string };
export interface TemplateWidget {
  kind: WidgetKind;
  title: Text;
  config: Record<string, unknown>;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Template {
  id: string;
  name: Text;
  widgets: TemplateWidget[];
}

const open: Filter = {
  op: 'and',
  rules: [{ field: 'statusCategory', operator: 'notIn', value: ['done', 'cancelled'] }],
};
const and = (...rules: Filter['rules']): Filter => ({
  op: 'and',
  rules: [...open.rules, ...rules],
});
const all: Filter = { op: 'and', rules: [] };
const mine: FilterRule = { field: 'assignee', operator: 'in', value: ['me'] };
const overdue: FilterRule = { field: 'dueDate', operator: 'before', value: 'today' };

/** Ready dashboards for the "New dashboard" dialog (PLANARAPP-48): widgets on the 12-column grid. */
export const TEMPLATES: Template[] = [
  {
    id: 'overview',
    name: { ru: 'Обзор пространства', en: 'Space overview' },
    widgets: [
      {
        kind: 'number',
        title: { ru: 'Открытые задачи', en: 'Open tasks' },
        config: { filter: open },
        x: 0,
        y: 0,
        w: 3,
        h: 2,
      },
      {
        kind: 'number',
        title: { ru: 'Просрочено', en: 'Overdue' },
        config: { filter: and(overdue) },
        x: 3,
        y: 0,
        w: 3,
        h: 2,
      },
      {
        kind: 'number',
        title: { ru: 'Без исполнителя', en: 'Unassigned' },
        config: { filter: and({ field: 'assignee', operator: 'isEmpty' }) },
        x: 6,
        y: 0,
        w: 3,
        h: 2,
      },
      {
        kind: 'number',
        title: { ru: 'Мои открытые', en: 'My open' },
        config: { filter: and(mine) },
        x: 9,
        y: 0,
        w: 3,
        h: 2,
      },
      {
        kind: 'bars',
        title: { ru: 'По статусам', en: 'By status' },
        config: { filter: all, groupBy: 'status' },
        x: 0,
        y: 2,
        w: 6,
        h: 4,
      },
      {
        kind: 'bars',
        title: { ru: 'Открытые по исполнителям', en: 'Open by assignee' },
        config: { filter: open, groupBy: 'assignee' },
        x: 6,
        y: 2,
        w: 6,
        h: 4,
      },
      {
        kind: 'line',
        title: { ru: 'Создано за 12 недель', en: 'Created, 12 weeks' },
        config: { filter: all, series: 'created', weeks: 12 },
        x: 0,
        y: 6,
        w: 6,
        h: 4,
      },
      {
        kind: 'line',
        title: { ru: 'Закрыто за 12 недель', en: 'Completed, 12 weeks' },
        config: { filter: all, series: 'completed', weeks: 12 },
        x: 6,
        y: 6,
        w: 6,
        h: 4,
      },
    ],
  },
  {
    id: 'my',
    name: { ru: 'Моя работа', en: 'My work' },
    widgets: [
      {
        kind: 'number',
        title: { ru: 'Мои открытые', en: 'My open' },
        config: { filter: and(mine) },
        x: 0,
        y: 0,
        w: 4,
        h: 2,
      },
      {
        kind: 'number',
        title: { ru: 'Мои просроченные', en: 'My overdue' },
        config: { filter: and(mine, overdue) },
        x: 4,
        y: 0,
        w: 4,
        h: 2,
      },
      {
        kind: 'number',
        title: { ru: 'Срок на неделе', en: 'Due this week' },
        config: { filter: and(mine, { field: 'dueDate', operator: 'before', value: 'today+7' }) },
        x: 8,
        y: 0,
        w: 4,
        h: 2,
      },
      {
        kind: 'list',
        title: { ru: 'Ближайшие сроки', en: 'Next due' },
        config: {
          filter: and(mine, { field: 'dueDate', operator: 'isNotEmpty' }),
          sort: 'dueDate',
          limit: 10,
        },
        x: 0,
        y: 2,
        w: 6,
        h: 5,
      },
      {
        kind: 'bars',
        title: { ru: 'Мои по приоритету', en: 'Mine by priority' },
        config: { filter: and(mine), groupBy: 'priority' },
        x: 6,
        y: 2,
        w: 6,
        h: 5,
      },
    ],
  },
  {
    id: 'sprint',
    name: { ru: 'Текущий спринт', en: 'Current sprint' },
    widgets: [
      {
        kind: 'number',
        title: { ru: 'Задач в спринте', en: 'Sprint tasks' },
        config: {
          filter: { op: 'and', rules: [{ field: 'cycle', operator: 'in', value: ['current'] }] },
        },
        x: 0,
        y: 0,
        w: 4,
        h: 2,
      },
      {
        kind: 'number',
        title: { ru: 'Осталось', en: 'Remaining' },
        config: { filter: and({ field: 'cycle', operator: 'in', value: ['current'] }) },
        x: 4,
        y: 0,
        w: 4,
        h: 2,
      },
      {
        kind: 'bars',
        title: { ru: 'Спринт по статусам', en: 'Sprint by status' },
        config: {
          filter: { op: 'and', rules: [{ field: 'cycle', operator: 'in', value: ['current'] }] },
          groupBy: 'status',
        },
        x: 0,
        y: 2,
        w: 6,
        h: 4,
      },
      {
        kind: 'bars',
        title: { ru: 'Осталось по исполнителям', en: 'Remaining by assignee' },
        config: {
          filter: and({ field: 'cycle', operator: 'in', value: ['current'] }),
          groupBy: 'assignee',
        },
        x: 6,
        y: 2,
        w: 6,
        h: 4,
      },
    ],
  },
];
