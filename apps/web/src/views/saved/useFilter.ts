import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import type { Row } from '@planar/shared';
import { useFieldDefsByIds } from '../../fields';
import { useAuth } from '../../auth/useAuth';
import type { TaskView } from '../../tasks';
import { db, useQuery } from '../../sync';
import { enabledForProject } from '../../modules/registry';
import { useAiStates } from '../aiFilter';
import { allRules, localToday, matchFilter, type Filter, type FilterCtx } from '../filter';

/**
 * View's Me Mode: 'mine' — toggle in Tasks (work for me: open tasks assigned to me and
 * tasks with unresolved comments assigned to me); the others — "My work" lists; null — all.
 * A saved value outside the type (the former 'day', PLNRAPP-709) works as null.
 */
export type MeMode = 'mine' | 'assigned' | 'created' | 'watched';

/** Tasks with an open comment or checklist item assigned to the user (PLNRAPP-140). */
export async function forMeTaskIds(uid: string): Promise<Set<string>> {
  const [comments, items] = await Promise.all([
    db.table<Row<'comments'>>('comments').where('assigneeId').equals(uid).toArray(),
    db.table<Row<'checklistItems'>>('checklistItems').where('assigneeId').equals(uid).toArray(),
  ]);
  return new Set(
    [...comments.filter((c) => !c.resolvedAt), ...items.filter((i) => !i.done)].map(
      (x) => x.taskId,
    ),
  );
}

/**
 * Predicate "task passes the view filter" (and Me Mode) for list/board/table/calendar.
 * projectId — the project of a project view (not a group one): its tasks' AI status for `aiStatus` rules.
 */
export function useTaskFilter(
  filter: MaybeRefOrGetter<Filter | null | undefined>,
  statuses: MaybeRefOrGetter<Row<'statuses'>[] | undefined>,
  me?: MaybeRefOrGetter<MeMode | null | undefined>,
  projectId?: () => string | undefined,
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
  const forMe = useQuery(() => forMeTaskIds(user.value?.id ?? ''));
  const mine = computed((): ((t: TaskView) => boolean) => {
    const m = toValue(me);
    const uid = user.value?.id ?? '';
    const closed = () =>
      new Set(
        (toValue(statuses) ?? [])
          .filter((s) => s.category === 'done' || s.category === 'cancelled')
          .map((s) => s.id),
      );
    // the task is mine: assigned to me, or an open comment / checklist item of it is (PLNRAPP-140)
    const my = (t: TaskView) => t.assigneeIds.includes(uid) || !!forMe.value?.has(t.id);
    if (m === 'mine') {
      // PLNRAPP-883: statuses are still loading — closed tasks are not known yet, none passes
      if (!toValue(statuses)) return () => false;
      const shut = closed();
      return (t) =>
        (t.assigneeIds.includes(uid) && !shut.has(t.statusId)) || !!forMe.value?.has(t.id);
    }
    if (m === 'assigned') return my;
    if (m === 'created') return (t) => t.createdBy === uid;
    if (m === 'watched') return (t) => !!watched.value?.has(t.id);
    return () => true;
  });
  const defs = useFieldDefsByIds(() =>
    [
      ...new Set(
        allRules(toValue(filter))
          .filter((r) => r.field.startsWith('field:'))
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
  // PLNRAPP-663: the AI status — only with an `aiStatus` rule and the ai module on in the project, otherwise the
  // rule is skipped (an old view's condition after the module is off does not hide tasks)
  const aiProject = () => {
    const pid = projectId?.();
    return pid &&
      allRules(toValue(filter)).some((r) => r.field === 'aiStatus') &&
      enabledForProject('ai', pid)
      ? pid
      : undefined;
  };
  const aiStates = useAiStates(aiProject);
  const rules = computed(() => {
    const f = toValue(filter);
    if (!f || !allRules(f).length) return () => true;
    // defs are still loading: field: rules must not let through extra items
    if (defs.value === undefined && allRules(f).some((r) => r.field.startsWith('field:')))
      return () => false;
    // PLNRAPP-883: the same for statuses — a statusCategory rule without them lets closed tasks
    // through for a moment (switching lists: «My day» → «Assigned» flashed done tasks)
    if (!toValue(statuses) && allRules(f).some((r) => r.field === 'statusCategory'))
      return () => false;
    const ctx = {
      statuses: toValue(statuses) ?? [],
      userId: user.value?.id ?? '',
      today: localToday(),
      fieldDefs: defs.value,
      cycles: cycles.value,
      forMe: forMe.value,
      aiStates: aiStates.value,
    };
    return (t: TaskView) => matchFilter(t, f, ctx);
  });
  return computed(() => {
    const a = rules.value;
    const b = mine.value;
    return (t: TaskView) => b(t) && a(t);
  });
}
