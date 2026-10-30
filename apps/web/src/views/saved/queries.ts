import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import type { Row } from '@planar/shared';
import { useAuth } from '../../auth/useAuth';
import { db, useQuery } from '../../sync';

export type SavedView = Row<'savedViews'>;

/** Space views visible to the user: his personal and shared ones, by rank. */
export function useSavedViews(spaceId: MaybeRefOrGetter<string>) {
  const { user } = useAuth();
  // the table is small: read it whole, pick the space and the owner in computed
  const all = useQuery(() => db.table<SavedView>('savedViews').toArray());
  return computed(() =>
    (all.value ?? [])
      .filter(
        (v) => v.spaceId === toValue(spaceId) && (v.userId === null || v.userId === user.value?.id),
      )
      .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0)),
  );
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
