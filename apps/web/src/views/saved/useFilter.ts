import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import type { Row } from '@planar/shared';
import { useFieldDefsByIds } from '../../fields';
import { useAuth } from '../../auth/useAuth';
import type { TaskView } from '../../tasks';
import { db, useQuery } from '../../sync';
import { localToday, matchFilter, type Filter, type FilterCtx } from '../filter';

/**
 * Me Mode вида: 'mine' — тумблер в Задачах (работа для меня: назначенные мне незакрытые задачи и
 * задачи с назначенными мне нерешёнными комментариями); остальные — списки «Моей работы»; null — все.
 */
export type MeMode = 'mine' | 'assigned' | 'created' | 'watched';

/** Предикат «задача проходит фильтр вида» (и Me Mode) для list/board/table/calendar. */
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
    if (m === 'mine') {
      const closed = new Set(
        (toValue(statuses) ?? [])
          .filter((s) => s.category === 'done' || s.category === 'cancelled')
          .map((s) => s.id),
      );
      return (t) =>
        (t.assigneeIds.includes(uid) && !closed.has(t.statusId)) || !!commented.value?.has(t.id);
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
  // таблицу sprintsCycles добавляет модуль sprints; без неё cycles не передаются
  const cycles = useQuery(() =>
    db.tables.some((t) => t.name === 'sprintsCycles')
      ? (db.table('sprintsCycles').toArray() as Promise<NonNullable<FilterCtx['cycles']>>)
      : undefined,
  );
  const rules = computed(() => {
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
  return computed(() => {
    const a = rules.value;
    const b = mine.value;
    return (t: TaskView) => b(t) && a(t);
  });
}
