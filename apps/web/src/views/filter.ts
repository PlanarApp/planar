import type { Row } from '@planar/shared';
import type { TaskView } from '../tasks';

export type BaseField =
  | 'status'
  | 'statusCategory'
  | 'assignee'
  | 'priority'
  | 'label'
  | 'dueDate'
  | 'title'
  | 'createdBy';
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
  /** без него `field:` правила пропускаются */
  fieldDefs?: Row<'fieldDefs'>[];
}

/** Допустимые операторы поля (конструктор и matchFilter). */
export const FIELD_OPERATORS: Record<BaseField, FilterOperator[]> = {
  status: ['in', 'notIn'],
  statusCategory: ['in', 'notIn'],
  assignee: ['in', 'notIn', 'isEmpty', 'isNotEmpty'],
  priority: ['in', 'notIn'],
  label: ['in', 'notIn', 'isEmpty', 'isNotEmpty'],
  dueDate: ['before', 'after', 'isEmpty', 'isNotEmpty'],
  title: ['contains'],
  createdBy: ['in', 'notIn'],
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
/** Операторы правила: `field:<id>` — по типу определения. */
export const operatorsFor = (
  field: FilterField,
  defs: Row<'fieldDefs'>[] = [],
): FilterOperator[] =>
  isFieldRule(field)
    ? BY_TYPE[defs.find((d) => d.id === field.slice(6))?.type ?? 'text']
    : FIELD_OPERATORS[field];
export const isFieldRule = (f: FilterField): f is `field:${string}` => f.startsWith('field:');

const NO_VALUE: FilterOperator[] = ['isEmpty', 'isNotEmpty'];

/** `YYYY-MM-DD` | `today` | `today+N` | `today-N` → дата; не разобралось — null. */
export function resolveDate(v: string, today: string): string | null {
  const m = /^today(?:([+-])(\d+))?$/.exec(v.trim());
  if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (m[1] === '-' ? -1 : 1) * Number(m[2] ?? 0));
  return d.toISOString().slice(0, 10);
}

/** Правило без значения (черновик в конструкторе) не участвует в отборе. */
const complete = (r: FilterRule) =>
  NO_VALUE.includes(r.operator) ||
  (Array.isArray(r.value)
    ? r.value.length > 0
    : typeof r.value === 'number' || (typeof r.value === 'string' && r.value !== ''));

function matchFieldRule(task: TaskView, r: FilterRule, ctx: FilterCtx, id: string): boolean {
  const def = ctx.fieldDefs?.find((d) => d.id === id);
  if (!def) return true; // нет определений или поле удалено — правило пропускается
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

function matchRule(task: TaskView, r: FilterRule, ctx: FilterCtx): boolean {
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
    case 'dueDate': {
      if (r.operator === 'isEmpty') return task.dueDate === null;
      if (r.operator === 'isNotEmpty') return task.dueDate !== null;
      const to = typeof r.value === 'string' ? resolveDate(r.value, ctx.today) : null;
      if (!task.dueDate || !to) return false;
      return r.operator === 'before' ? task.dueDate < to : task.dueDate > to;
    }
    case 'title':
      return task.title.toLowerCase().includes(String(r.value).toLowerCase());
  }
}

export function matchFilter(
  task: TaskView,
  filter: Filter | null | undefined,
  ctx: FilterCtx,
): boolean {
  const rules = filter?.rules.filter(complete) ?? [];
  if (!rules.length) return true;
  const f = (r: FilterRule) => matchRule(task, r, ctx);
  return filter!.op === 'or' ? rules.some(f) : rules.every(f);
}

/** Сегодня по местному времени, `YYYY-MM-DD`. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
