import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import type { Row } from '@planar/shared';
import { useAuth } from '../../auth/useAuth';
import { db, useQuery } from '../../sync';

export type SavedView = Row<'savedViews'>;

/** Виды пространства, видимые пользователю: его личные и общие, по rank. */
export function useSavedViews(spaceId: MaybeRefOrGetter<string>) {
  const { user } = useAuth();
  // таблица маленькая: читаем целиком, пространство и владельца отбираем в computed
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

/** Общий вид можно создавать и править участнику с правом member и выше (не гость). */
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
