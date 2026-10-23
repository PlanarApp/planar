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

/** Сегодня по местному времени, `YYYY-MM-DD`. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
