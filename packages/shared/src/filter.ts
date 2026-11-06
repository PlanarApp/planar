import type { Row } from './contract/index.js';

/** Task for filtering: row + assignee and label ids. */
export type FilterTask = Row<'tasks'> & { assigneeIds: string[]; labelIds: string[] };

export type BaseField =
  | 'status'
  | 'statusCategory'
  | 'assignee'
  | 'priority'
  | 'label'
  | 'dueDate'
  | 'title'
  /** title or description (quick filter, PLNRAPP-79) */
  | 'text'
  | 'createdBy'
  | 'cycle';
export type FilterField = BaseField | `field:${string}`;
export type FilterOperator =
  'in' | 'notIn' | 'isEmpty' | 'isNotEmpty' | 'before' | 'after' | 'contains' | 'gte' | 'lte';
export interface FilterRule {
  field: FilterField;
  operator: FilterOperator;
  value?: string[] | number[] | string | number;
}
export interface Filter {
  op: 'and' | 'or';
  rules: FilterRule[];
}
export interface FilterCtx {
  statuses: Row<'statuses'>[];
  userId: string;
  today: string;
  /** without it `field:` rules are skipped */
  fieldDefs?: Row<'fieldDefs'>[];
  /** sprint cycles; without them rules with `'current'` are skipped */
  cycles?: {
    id: string;
    projectId: string;
    startDate: string;
    endDate: string;
    closedAt: string | null;
  }[];
}

/** Allowed operators of a field (constructor and matchFilter). */
export const FIELD_OPERATORS: Record<BaseField, FilterOperator[]> = {
  status: ['in', 'notIn'],
  statusCategory: ['in', 'notIn'],
  assignee: ['in', 'notIn', 'isEmpty', 'isNotEmpty'],
  priority: ['in', 'notIn'],
  label: ['in', 'notIn', 'isEmpty', 'isNotEmpty'],
  dueDate: ['before', 'after', 'isEmpty', 'isNotEmpty'],
  title: ['contains'],
  text: ['contains'],
  createdBy: ['in', 'notIn'],
  cycle: ['in', 'notIn', 'isEmpty', 'isNotEmpty'],
};

const EMPTY: FilterOperator[] = ['isEmpty', 'isNotEmpty'];
const BY_TYPE: Record<Row<'fieldDefs'>['type'], FilterOperator[]> = {
  text: ['contains', ...EMPTY],
  url: ['contains', ...EMPTY],
  number: ['gte', 'lte', ...EMPTY],
  money: ['gte', 'lte', ...EMPTY],
  date: ['before', 'after', ...EMPTY],
  select: ['in', 'notIn', ...EMPTY],
  user: ['in', 'notIn', ...EMPTY],
};
/** Rule operators: `field:<id>` — by the definition type. */
export const operatorsFor = (
  field: FilterField,
  defs: Row<'fieldDefs'>[] = [],
): FilterOperator[] =>
  isFieldRule(field)
    ? BY_TYPE[defs.find((d) => d.id === field.slice(6))?.type ?? 'text']
    : FIELD_OPERATORS[field];
export const isFieldRule = (f: FilterField): f is `field:${string}` => f.startsWith('field:');

const NO_VALUE: FilterOperator[] = ['isEmpty', 'isNotEmpty'];

/** `YYYY-MM-DD` | `today` | `today+N` | `today-N` → date; if not parsed — null. */
export function resolveDate(v: string, today: string): string | null {
  const m = /^today(?:([+-])(\d+))?$/.exec(v.trim());
  if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (m[1] === '-' ? -1 : 1) * Number(m[2] ?? 0));
  return d.toISOString().slice(0, 10);
}

/** A rule without a value (a draft in the constructor) does not take part in filtering. */
const complete = (r: FilterRule) =>
  NO_VALUE.includes(r.operator) ||
  (Array.isArray(r.value)
    ? r.value.length > 0
    : typeof r.value === 'number' || (typeof r.value === 'string' && r.value !== ''));

function matchFieldRule(task: FilterTask, r: FilterRule, ctx: FilterCtx, id: string): boolean {
  const def = ctx.fieldDefs?.find((d) => d.id === id);
  if (!def) return true; // no definitions or the field is deleted — the rule is skipped
  const v = task.fields[id];
  if (r.operator === 'isEmpty') return v === undefined;
  if (r.operator === 'isNotEmpty') return v !== undefined;
  if (v === undefined) return false;
  const ids = (Array.isArray(r.value) ? r.value : []).map((x) =>
    x === 'me' ? ctx.userId : String(x),
  );
  switch (r.operator) {
    case 'in':
      return ids.includes(String(v));
    case 'notIn':
      return !ids.includes(String(v));
    case 'contains':
      return String(v).toLowerCase().includes(String(r.value).toLowerCase());
    case 'gte':
    case 'lte': {
      if (typeof v !== 'number' || typeof r.value !== 'number') return false;
      return r.operator === 'gte' ? v >= r.value : v <= r.value;
    }
    case 'before':
    case 'after': {
      const to = typeof r.value === 'string' ? resolveDate(r.value, ctx.today) : null;
      if (typeof v !== 'string' || !to) return false;
      return r.operator === 'before' ? v < to : v > to;
    }
    default:
      return false;
  }
}

function matchRule(task: FilterTask, r: FilterRule, ctx: FilterCtx): boolean {
  if (isFieldRule(r.field)) return matchFieldRule(task, r, ctx, r.field.slice(6));
  const me = (v: unknown) => (v === 'me' ? ctx.userId : String(v));
  const list = (Array.isArray(r.value) ? r.value : []).map(me);
  const has = (ids: string[]) => ids.some((i) => list.includes(i));
  const neg = r.operator === 'notIn';
  const isIn = (ids: string[]) => (neg ? !has(ids) : has(ids));
  switch (r.field) {
    case 'status':
      return isIn([task.statusId]);
    case 'statusCategory':
      return isIn([ctx.statuses.find((s) => s.id === task.statusId)?.category ?? '']);
    case 'priority':
      return isIn([String(task.priority)]);
    case 'createdBy':
      return isIn([task.createdBy]);
    case 'assignee':
    case 'label': {
      const ids = r.field === 'assignee' ? task.assigneeIds : task.labelIds;
      if (r.operator === 'isEmpty') return ids.length === 0;
      if (r.operator === 'isNotEmpty') return ids.length > 0;
      return isIn(ids);
    }
    case 'cycle': {
      if (r.operator === 'isEmpty') return task.cycleId === null;
      if (r.operator === 'isNotEmpty') return task.cycleId !== null;
      const ids = (Array.isArray(r.value) ? r.value : []).map(String);
      if (ids.includes('current') && !ctx.cycles) return true; // without cycles the rule is skipped
      const current = ctx.cycles?.some(
        (c) =>
          c.id === task.cycleId &&
          c.projectId === task.projectId &&
          c.closedAt === null &&
          c.startDate <= ctx.today &&
          ctx.today <= c.endDate,
      );
      const hit =
        (task.cycleId !== null && ids.includes(task.cycleId)) ||
        (!!current && ids.includes('current'));
      return neg ? !hit : hit;
    }
    case 'dueDate': {
      if (r.operator === 'isEmpty') return task.dueDate === null;
      if (r.operator === 'isNotEmpty') return task.dueDate !== null;
      const to = typeof r.value === 'string' ? resolveDate(r.value, ctx.today) : null;
      if (!task.dueDate || !to) return false;
      return r.operator === 'before' ? task.dueDate < to : task.dueDate > to;
    }
    case 'title':
      return task.title.toLowerCase().includes(String(r.value).toLowerCase());
    case 'text': {
      const q = String(r.value).toLowerCase();
      return task.title.toLowerCase().includes(q) || descText(task.description).includes(q);
    }
  }
}

// description text, lowercased; cached by the doc object — the quick filter reruns on every keystroke
const descCache = new WeakMap<object, string>();
const docText = (n: unknown): string => {
  if (!n || typeof n !== 'object') return '';
  const o = n as { text?: unknown; content?: unknown[] };
  return (
    (typeof o.text === 'string' ? o.text + ' ' : '') +
    (Array.isArray(o.content) ? o.content.map(docText).join('') : '')
  );
};
function descText(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return '';
  let s = descCache.get(doc);
  if (s === undefined) descCache.set(doc, (s = docText(doc).toLowerCase()));
  return s;
}

/**
 * Status/label rules of a filter match by NAME (case-insensitive), so one rule covers same-named statuses of
 * all projects: the picked ids are widened by the ids of same-named rows. The stored format is unchanged
 * (old id rules keep working).
 */
export function widenByName<F extends { rules: { field: string; value?: unknown }[] }>(
  filter: F,
  statuses: { id: string; name: string }[],
  labels: { id: string; name: string }[],
): F {
  const norm = (name: string) => name.trim().toLowerCase();
  const widen = (value: unknown, dict: { id: string; name: string }[]) => {
    if (!Array.isArray(value)) return value;
    const names = new Set(dict.filter((d) => value.includes(d.id)).map((d) => norm(d.name)));
    return [
      ...new Set([...value, ...dict.filter((d) => names.has(norm(d.name))).map((d) => d.id)]),
    ];
  };
  return {
    ...filter,
    rules: filter.rules.map((r) =>
      r.field === 'status'
        ? { ...r, value: widen(r.value, statuses) }
        : r.field === 'label'
          ? { ...r, value: widen(r.value, labels) }
          : r,
    ),
  };
}

export function matchFilter(
  task: FilterTask,
  filter: Filter | null | undefined,
  ctx: FilterCtx,
): boolean {
  const rules = filter?.rules.filter(complete) ?? [];
  if (!rules.length) return true;
  const f = (r: FilterRule) => matchRule(task, r, ctx);
  return filter!.op === 'or' ? rules.some(f) : rules.every(f);
}
