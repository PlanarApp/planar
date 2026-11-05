export {
  FIELD_OPERATORS,
  isFieldRule,
  matchFilter,
  operatorsFor,
  resolveDate,
  type BaseField,
  type Filter,
  type FilterCtx,
  type FilterField,
  type FilterOperator,
  type FilterRule,
  type FilterTask,
} from '@planar/shared';

/** Today in local time, `YYYY-MM-DD`. */
export function localToday(days = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
