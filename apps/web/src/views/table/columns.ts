export const COLUMN_IDS = [
  'title',
  'key',
  'project',
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
/** A system column or `field:<fieldId>` (a user field). */
export type ColumnId = SystemColumnId | `field:${string}`;
export const FIELD_PREFIX = 'field:';
export const isFieldCol = (id: string): id is `field:${string}` =>
  id.startsWith(FIELD_PREFIX) && id.length > FIELD_PREFIX.length;
export interface ColumnState {
  id: ColumnId;
  width: number;
  /** width set by dragging; otherwise — auto-size by content */
  manual?: boolean;
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
  project: 150,
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
/** group summary (several projects): by default, and the "Project" column after the key */
export const scopeLayout = (): Layout => ({
  columns: ['title', 'key', 'project', ...DEFAULT_IDS.slice(2)].map((id) =>
    newColumn(id as SystemColumnId),
  ),
});

const storageKey = (projectId: string) => `planar.table.${projectId}`;

/** Layout from arbitrary data; unknown ids and duplicates are skipped, the width is clamped. */
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
      // old layouts without the flag: a non-default width means it was dragged
      ...((c.manual === true ||
        (c.manual === undefined &&
          typeof c.width === 'number' &&
          clampWidth(c.width) !== newColumn(id).width)) && { manual: true }),
    });
  }
  return columns.length ? columns : undefined;
}

/** Layout from localStorage (fallback); broken JSON — defaults. */
export function loadLayout(projectId: string, fallback: () => Layout = defaultLayout): Layout {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    const columns = parseColumns(raw && JSON.parse(raw)?.columns);
    if (columns) return { columns };
  } catch {
    // no storage or broken JSON — default layout
  }
  return fallback();
}

export function saveLayout(projectId: string, layout: Layout): void {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(layout));
  } catch {
    // quota or private mode — layout lives until reload
  }
}

export function moveColumn(cols: ColumnState[], from: number, to: number): ColumnState[] {
  if (from === to || !cols[from] || to < 0 || to >= cols.length) return cols;
  const next = [...cols];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
