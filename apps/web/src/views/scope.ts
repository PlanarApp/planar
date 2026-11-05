import { computed, toValue, type MaybeRefOrGetter, type Ref } from 'vue';
import { widenByName, type Row } from '@planar/shared';
import type { ViewProps } from '.';
import { updateTask, useSpaces } from '../tasks';
import { db, useQuery } from '../sync';
import type { Filter } from './filter';

const norm = (name: string) => name.trim().toLowerCase();

const isSummary = (scope: ViewProps['scope']) =>
  !!scope && (scope.projectIds.length > 1 || scope.spaceIds.length > 1);

/** The project whose dictionaries (statuses, labels) a view reads: its own, or the only project of a scope
 * ("My work" of a project); a summary — undefined, i.e. all projects of the space. */
export const dictProjectOf = (scope: ViewProps['scope'], projectId: string) =>
  !scope ? projectId : isSummary(scope) ? undefined : scope.projectIds[0];

/**
 * Summary of several projects (statuses belong to a project, PJ-2): statuses with the same name — one group
 * (key — the name, case-insensitive); one project — the key stays the status id (undefined).
 */
export function useStatusKey(
  scope: MaybeRefOrGetter<ViewProps['scope']>,
  statuses: Readonly<Ref<Row<'statuses'>[] | undefined>>,
) {
  return computed(() => {
    if (!isSummary(toValue(scope))) return undefined;
    const name = new Map((statuses.value ?? []).map((s) => [s.id, norm(s.name)]));
    return (id: string) => name.get(id) ?? id;
  });
}

/** the same for labels: in a summary the group key is the label name */
export function useLabelKey(
  scope: MaybeRefOrGetter<ViewProps['scope']>,
  labels: Readonly<Ref<Row<'labels'>[] | undefined>>,
) {
  return computed(() => {
    if (!isSummary(toValue(scope))) return undefined;
    const name = new Map((labels.value ?? []).map((l) => [l.id, norm(l.name)]));
    return (id: string) => name.get(id) ?? id;
  });
}

/** the status of project `projectId` that corresponds to the picked one (same id or same name); no such one — undefined */
export function statusIn(statuses: Row<'statuses'>[], projectId: string, pickedId: string) {
  const picked = statuses.find((s) => s.id === pickedId);
  if (!picked) return undefined;
  return statuses.find(
    (s) => s.projectId === projectId && (s.id === pickedId || norm(s.name) === norm(picked.name)),
  )?.id;
}

/** bulk status: the picked status → the same-named status of the task's own project; none there — the task is skipped */
export function setStatusByName(
  statuses: Row<'statuses'>[],
  task: { id: string; projectId: string },
  pickedId: string | undefined,
): Promise<unknown> {
  // a picked status missing from the dictionary (not loaded yet) is set as is
  const id =
    pickedId &&
    (statuses.some((s) => s.id === pickedId)
      ? statusIn(statuses, task.projectId, pickedId)
      : pickedId);
  return id ? updateTask(task.id, { statusId: id }) : Promise.resolve();
}

/** label group `key` (id, or name in a summary) → the label of project `projectId`; none — undefined */
export const labelFor = (labels: Row<'labels'>[], projectId: string, key: string) =>
  labels.find((l) => l.projectId === projectId && (l.id === key || norm(l.name) === key))?.id;

/** the task's project status for the name group `key`; no such one — undefined (the column does not accept it) */
export const statusFor = (
  statuses: Row<'statuses'>[],
  spaceId: string,
  key: string,
  projectId?: string, // statuses belong to a project (PJ-1); without it — the first of the space
) =>
  statuses.find(
    (s) =>
      s.spaceId === spaceId && (!projectId || s.projectId === projectId) && norm(s.name) === key,
  )?.id;

export { widenByName };

/** the view filter with status/label rules widened by name (see widenByName) — pass it to useTaskFilter */
export function useWidenedFilter(filter: MaybeRefOrGetter<Filter | null | undefined>) {
  const statuses = useQuery(() => db.table<Row<'statuses'>>('statuses').toArray());
  const labels = useQuery(() => db.table<Row<'labels'>>('labels').toArray());
  return computed(() => {
    const f = toValue(filter);
    return f?.rules.length ? widenByName(f, statuses.value ?? [], labels.value ?? []) : f;
  });
}

/** project id → name: the "Project" field in rows and on cards */
export function useProjectNames() {
  const spaces = useSpaces();
  return computed(
    () => new Map((spaces.value ?? []).flatMap((s) => s.projects.map((p) => [p.id, p.name]))),
  );
}

/**
 * Move plan in a multi-space summary: the column key is the status name; we set the status with this name
 * in the task's space; if there is none — no move (null).
 */
export function fixPlan<P extends { statusId?: string; labels?: string[] }>(
  plan: P | null,
  task: { spaceId: string; projectId: string } | undefined,
  byName: boolean,
  statuses: Row<'statuses'>[],
  labels: Row<'labels'>[] = [],
): P | null {
  if (!plan || !byName) return plan;
  let out = plan;
  if (plan.labels && task) {
    // label keys of a summary are names: back to the ids of the task's project (no such label — dropped)
    const own = labels.filter((l) => l.projectId === task.projectId);
    out = {
      ...out,
      labels: plan.labels.flatMap((k) => {
        const l = own.find((x) => x.id === k || norm(x.name) === k);
        return l ? [l.id] : [];
      }),
    };
  }
  if (!plan.statusId) return out;
  const id = task && statusFor(statuses, task.spaceId, plan.statusId, task.projectId);
  return id ? { ...out, statusId: id } : null;
}

/** Status of a new task: status columns/groups (id or name in the summary) or the task's space "To do". */
export function createStatus(
  statuses: Row<'statuses'>[],
  spaceId: string,
  groupKey: string | undefined,
  byName: boolean,
  projectId?: string,
): string | undefined {
  const own = statuses.filter(
    (s) => s.spaceId === spaceId && (!projectId || s.projectId === projectId),
  );
  if (groupKey) return byName ? statusFor(statuses, spaceId, groupKey, projectId) : groupKey;
  return (own.find((s) => s.category === 'todo') ?? own[0])?.id;
}

/** Status of a new task of the project (statuses belong to a project, PJ-1): its first "To do", otherwise the first. */
export function defaultStatus(statuses: Row<'statuses'>[], projectId: string): string | undefined {
  const own = statuses.filter((s) => s.projectId === projectId);
  return (own.find((s) => s.category === 'todo') ?? own[0])?.id;
}
