export const COLUMN_IDS = [
  'title',
  'key',
  'status',
  'assignee',
  'priority',
  'dueDate',
  'startDate',
  'labels',
  'createdAt',
  'updatedAt',
] as const;
export type SystemColumnId = (typeof COLUMN_IDS)[number];
/** Системная колонка или `field:<fieldId>` (пользовательское поле). */
export type ColumnId = SystemColumnId | `field:${string}`;
export const FIELD_PREFIX = 'field:';
export const isFieldCol = (id: string): id is `field:${string}` =>
  id.startsWith(FIELD_PREFIX) && id.length > FIELD_PREFIX.length;
export interface ColumnState {
  id: ColumnId;
  width: number;
}
export interface Layout {
  columns: ColumnState[];
}

export const MIN_W = 60;
export const MAX_W = 800;
const FIELD_W = 160;
const DEFAULT_W: Record<SystemColumnId, number> = {
  title: 360,
  key: 90,
  status: 150,
  assignee: 150,
  priority: 120,
  dueDate: 130,
  startDate: 130,
  labels: 180,
  createdAt: 150,
  updatedAt: 150,
};
const DEFAULT_IDS: SystemColumnId[] = [
  'title',
  'key',
  'status',
  'assignee',
  'priority',
  'dueDate',
  'labels',
];

export const clampWidth = (w: number): number =>
  Math.min(MAX_W, Math.max(MIN_W, Number.isFinite(w) ? Math.round(w) : MIN_W));
export const newColumn = (id: ColumnId): ColumnState => ({
  id,
  width: isFieldCol(id) ? FIELD_W : DEFAULT_W[id as SystemColumnId],
});
export const defaultLayout = (): Layout => ({ columns: DEFAULT_IDS.map(newColumn) });

const storageKey = (projectId: string) => `planar.table.${projectId}`;

/** Раскладка из произвольных данных; неизвестные id и повторы пропускаются, ширина зажимается. */
export function parseColumns(cols: unknown): ColumnState[] | undefined {
  if (!Array.isArray(cols)) return undefined;
  const seen = new Set<string>();
  const columns: ColumnState[] = [];
  for (const c of cols) {
    const id = c?.id as ColumnId;
    if (!(COLUMN_IDS.includes(id as SystemColumnId) || isFieldCol(String(id))) || seen.has(id))
      continue;
    seen.add(id);
    columns.push({
      id,
      width: typeof c.width === 'number' ? clampWidth(c.width) : newColumn(id).width,
    });
  }
  return columns.length ? columns : undefined;
}

/** Раскладка из localStorage (запасной вариант); битый JSON — по умолчанию. */
export function loadLayout(projectId: string): Layout {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    const columns = parseColumns(raw && JSON.parse(raw)?.columns);
    if (columns) return { columns };
  } catch {
    // нет хранилища или битый JSON — раскладка по умолчанию
  }
  return defaultLayout();
}

export function saveLayout(projectId: string, layout: Layout): void {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(layout));
  } catch {
    // квота или приватный режим — раскладка живёт до перезагрузки
  }
}

export function moveColumn(cols: ColumnState[], from: number, to: number): ColumnState[] {
  if (from === to || !cols[from] || to < 0 || to >= cols.length) return cols;
  const next = [...cols];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
