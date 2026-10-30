import { computed, toValue, type MaybeRefOrGetter, type Ref } from 'vue';
import type { Row } from '@planar/shared';
import type { ViewProps } from '.';
import { useSpaces } from '../tasks';

const norm = (name: string) => name.trim().toLowerCase();

/**
 * Summary of several spaces: statuses with the same name — one group (key — the name, as "Everything" in
 * ClickUp); one space — the key stays the status id (undefined).
 */
export function useStatusKey(
  scope: MaybeRefOrGetter<ViewProps['scope']>,
  statuses: Readonly<Ref<Row<'statuses'>[] | undefined>>,
) {
  return computed(() => {
    if ((toValue(scope)?.spaceIds.length ?? 0) < 2) return undefined;
    const name = new Map((statuses.value ?? []).map((s) => [s.id, norm(s.name)]));
    return (id: string) => name.get(id) ?? id;
  });
}

/** the task's space status for the name group `key`; no such one — undefined (the column does not accept it) */
export const statusFor = (statuses: Row<'statuses'>[], spaceId: string, key: string) =>
  statuses.find((s) => s.spaceId === spaceId && norm(s.name) === key)?.id;

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
export function fixPlan<P extends { statusId?: string }>(
  plan: P | null,
  task: { spaceId: string } | undefined,
  byName: boolean,
  statuses: Row<'statuses'>[],
): P | null {
  if (!plan || !byName || !plan.statusId) return plan;
  const id = task && statusFor(statuses, task.spaceId, plan.statusId);
  return id ? { ...plan, statusId: id } : null;
}

/** Status of a new task: status columns/groups (id or name in the summary) or the task's space "To do". */
export function createStatus(
  statuses: Row<'statuses'>[],
  spaceId: string,
  groupKey: string | undefined,
  byName: boolean,
): string | undefined {
  const own = statuses.filter((s) => s.spaceId === spaceId);
  if (groupKey) return byName ? statusFor(statuses, spaceId, groupKey) : groupKey;
  return (own.find((s) => s.category === 'todo') ?? own[0])?.id;
}
