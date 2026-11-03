import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import type { Row } from '@planar/shared';
import { useAuth } from '../../auth/useAuth';
import { db, useQuery } from '../../sync';

export type SavedView = Row<'savedViews'>;

/** Named space views visible to the user: his personal and shared ones, by rank (without node views). */
export function useSavedViews(spaceId: MaybeRefOrGetter<string>) {
  const { user } = useAuth();
  // the table is small: read it whole, pick the space and the owner in computed
  const all = useQuery(() => db.table<SavedView>('savedViews').toArray());
  return computed(() =>
    (all.value ?? [])
      .filter(
        (v) =>
          !v.node &&
          v.spaceId === toValue(spaceId) &&
          (v.userId === null || v.userId === user.value?.id),
      )
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0)),
  );
}

/** My personal row and the shared default of a built-in tab in a node; undefined — loading. */
export function useNodeViewRows(node: MaybeRefOrGetter<string>, layout: MaybeRefOrGetter<string>) {
  const { user } = useAuth();
  const all = useQuery(() => db.table<SavedView>('savedViews').toArray());
  return computed(() => {
    if (!all.value) return undefined;
    // shortcut: no unique index — after a race of two devices the freshest row wins
    const rows = all.value
      .filter((v) => v.node === toValue(node) && v.layout === toValue(layout))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return {
      personal: rows.find((v) => v.userId === user.value?.id) ?? null,
      shared: rows.find((v) => v.userId === null) ?? null,
    };
  });
}

/** The effective view of a node tab: my personal row, else the shared default; null — none. */
export function useNodeView(node: MaybeRefOrGetter<string>, layout: MaybeRefOrGetter<string>) {
  const rows = useNodeViewRows(node, layout);
  return computed(() => (rows.value ? (rows.value.personal ?? rows.value.shared) : undefined));
}

export function useSavedView(id: MaybeRefOrGetter<string>) {
  const all = useQuery(() => db.table<SavedView>('savedViews').toArray());
  return computed(() =>
    all.value ? (all.value.find((v) => v.id === toValue(id)) ?? null) : undefined,
  );
}

/** A shared view can be created and edited by a member with the member right and above (not a guest). */
export function useCanShare(spaceId: MaybeRefOrGetter<string>) {
  const { user } = useAuth();
  const members = useQuery(() => db.table<Row<'spaceMembers'>>('spaceMembers').toArray());
  return computed(() => {
    const m = members.value?.find(
      (x) => x.spaceId === toValue(spaceId) && x.userId === user.value?.id,
    );
    return !!m && m.role !== 'guest';
  });
}
