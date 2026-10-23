import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import type { Row } from '@planar/shared';
import { useFieldDefsByIds } from '../../fields';
import { useAuth } from '../../auth/useAuth';
import type { TaskView } from '../../tasks';
import { db, useQuery } from '../../sync';
import { localToday, matchFilter, type Filter, type FilterCtx } from '../filter';

/** Предикат «задача проходит фильтр вида» для list/board. */
export function useTaskFilter(
  filter: MaybeRefOrGetter<Filter | null | undefined>,
  statuses: MaybeRefOrGetter<Row<'statuses'>[] | undefined>,
) {
  const { user } = useAuth();
  const defs = useFieldDefsByIds(() =>
    [
      ...new Set(
        toValue(filter)
          ?.rules.filter((r) => r.field.startsWith('field:'))
          .map((r) => r.field.slice(6)),
      ),
    ].join(','),
  );
  // таблицу sprintsCycles добавляет модуль sprints; без неё cycles не передаются
  const cycles = useQuery(() =>
    db.tables.some((t) => t.name === 'sprintsCycles')
      ? (db.table('sprintsCycles').toArray() as Promise<NonNullable<FilterCtx['cycles']>>)
      : undefined,
  );
  return computed(() => {
    const f = toValue(filter);
    if (!f?.rules.length) return () => true;
    // defs ещё грузятся: field:-правила не должны пропускать лишнее
    if (defs.value === undefined && f.rules.some((r) => r.field.startsWith('field:')))
      return () => false;
    const ctx = {
      statuses: toValue(statuses) ?? [],
      userId: user.value?.id ?? '',
      today: localToday(),
      fieldDefs: defs.value,
      cycles: cycles.value,
    };
    return (t: TaskView) => matchFilter(t, f, ctx);
  });
}
