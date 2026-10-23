import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import type { Row } from '@planar/shared';
import { useAuth } from '../../auth/useAuth';
import type { TaskView } from '../../tasks';
import { localToday, matchFilter, type Filter } from '../filter';

/** Предикат «задача проходит фильтр вида» для list/board. */
export function useTaskFilter(
  filter: MaybeRefOrGetter<Filter | null | undefined>,
  statuses: MaybeRefOrGetter<Row<'statuses'>[] | undefined>,
) {
  const { user } = useAuth();
  return computed(() => {
    const f = toValue(filter);
    if (!f?.rules.length) return (_: TaskView) => true;
    const ctx = {
      statuses: toValue(statuses) ?? [],
      userId: user.value?.id ?? '',
      today: localToday(),
    };
    return (t: TaskView) => matchFilter(t, f, ctx);
  });
}
