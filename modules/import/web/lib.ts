import type { ImportPreset, Mapping } from '../shared/index.js';

export const FIELDS = [
  'externalId',
  'title',
  'description',
  'status',
  'assignee',
  'labels',
  'dueDate',
  'startDate',
  'priority',
  'parent',
] as const;

/** Допустимые источники для формата. */
export const presetsFor = (format: 'csv' | 'trello'): ImportPreset[] =>
  format === 'trello' ? ['trello'] : ['clickup', 'jira', 'linear', 'custom'];

/** Разные значения колонки статуса в строках предпросмотра (по порядку появления). */
export function statusValues(columns: string[], rows: string[][], column?: string): string[] {
  const i = column ? columns.indexOf(column) : -1;
  if (i < 0) return [];
  return [...new Set(rows.map((r) => (r[i] ?? '').trim()).filter(Boolean))];
}

/** Mapping для отправки: пустые поля убраны, statusMap — только выбранные значения. */
export function buildMapping(m: Partial<Mapping>, chosen: Record<string, string>): Mapping {
  const out: Record<string, unknown> = {};
  for (const f of FIELDS) if (m[f]) out[f] = m[f];
  const statusMap = Object.fromEntries(Object.entries(chosen).filter(([, id]) => id));
  if (m.status && Object.keys(statusMap).length) out.statusMap = statusMap;
  return out as unknown as Mapping;
}

/** Статус по умолчанию для подсказки: имя статуса, равное значению без регистра. */
export function guessStatus(value: string, statuses: { id: string; name: string }[]): string {
  return statuses.find((s) => s.name.toLowerCase() === value.toLowerCase())?.id ?? '';
}
