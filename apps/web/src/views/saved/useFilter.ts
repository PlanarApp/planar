import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import type { Row } from '@planar/shared';
import { useFieldDefsByIds } from '../../fields';
import { useAuth } from '../../auth/useAuth';
import type { TaskView } from '../../tasks';
import { db, useQuery } from '../../sync';
import { localToday, matchFilter, type Filter, type FilterCtx } from '../filter';

/**
 * View's Me Mode: 'mine' — toggle in Tasks (work for me: open tasks assigned to me and
 * tasks with unresolved comments assigned to me); the others — "My work" lists; null — all.
 * 'day' — the list under the «My day» planner: open assigned, due now (overdue, today or started) or without a date.
 */
export type MeMode = 'mine' | 'assigned' | 'created' | 'watched' | 'day';

/** Predicate "task passes the view filter" (and Me Mode) for list/board/table/calendar. */
export function useTaskFilter(
  filter: MaybeRefOrGetter<Filter | null | undefined>,
  statuses: MaybeRefOrGetter<Row<'statuses'>[] | undefined>,
  me?: MaybeRefOrGetter<MeMode | null | undefined>,
) {
  const { user } = useAuth();
  const watched = useQuery(
    async () =>
      new Set(
        (
          await db
            .table<Row<'taskWatchers'>>('taskWatchers')
            .where('userId')
            .equals(user.value?.id ?? '')
            .toArray()
        ).map((w) => w.taskId),
      ),
  );
  const commented = useQuery(async () => {
    const uid = user.value?.id ?? '';
    return new Set(
      (
        await db
          .table<Row<'comments'>>('comments')
          .filter((c) => c.assigneeId === uid && !c.resolvedAt)
          .toArray()
      ).map((c) => c.taskId),
    );
  });
  const mine = computed((): ((t: TaskView) => boolean) => {
    const m = toValue(me);
    const uid = user.value?.id ?? '';
    const closed = () =>
      new Set(
        (toValue(statuses) ?? [])
          .filter((s) => s.category === 'done' || s.category === 'cancelled')
          .map((s) => s.id),
      );
    if (m === 'mine') {
      const shut = closed();
      return (t) =>
        (t.assigneeIds.includes(uid) && !shut.has(t.statusId)) || !!commented.value?.has(t.id);
    }
    // PLNRAPP-137, as the former «My day» list (PLNRAPP-81): later due dates are not shown
    if (m === 'day') {
      const shut = closed();
      const today = localToday();
      return (t) =>
        t.assigneeIds.includes(uid) &&
        !shut.has(t.statusId) &&
        (!t.dueDate || t.dueDate <= today || (!!t.startDate && t.startDate <= today));
    }
    if (m === 'assigned') return (t) => t.assigneeIds.includes(uid);
    if (m === 'created') return (t) => t.createdBy === uid;
    if (m === 'watched') return (t) => !!watched.value?.has(t.id);
    return () => true;
  });
  const defs = useFieldDefsByIds(() =>
    [
      ...new Set(
        toValue(filter)
          ?.rules.filter((r) => r.field.startsWith('field:'))
          .map((r) => r.field.slice(6)),
      ),
    ].join(','),
  );
  // the sprintsCycles table is added by the sprints module; without it cycles are not passed
  const cycles = useQuery(() =>
    db.tables.some((t) => t.name === 'sprintsCycles')
      ? (db.table('sprintsCycles').toArray() as Promise<NonNullable<FilterCtx['cycles']>>)
      : undefined,
  );
  const rules = computed(() => {
    const f = toValue(filter);
    if (!f?.rules.length) return () => true;
    // defs are still loading: field: rules must not let through extra items
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
  return computed(() => {
    const a = rules.value;
    const b = mine.value;
    return (t: TaskView) => b(t) && a(t);
  });
}
