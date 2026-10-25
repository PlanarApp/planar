import { computed, toValue, type MaybeRefOrGetter, type Ref } from 'vue';
import type { Row } from '@planar/shared';
import type { ViewProps } from '.';
import { useSpaces } from '../tasks';

const norm = (name: string) => name.trim().toLowerCase();

/**
 * Сводка нескольких пространств: статусы с одинаковым именем — одна группа (ключ — имя, как «Everything» в
 * ClickUp); одно пространство — ключ остаётся id статуса (undefined).
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

/** статус пространства задачи для группы-имени `key`; нет такого — undefined (колонка не принимает) */
export const statusFor = (statuses: Row<'statuses'>[], spaceId: string, key: string) =>
  statuses.find((s) => s.spaceId === spaceId && norm(s.name) === key)?.id;

/** id проекта → название: поле «Проект» в строках и на карточках */
export function useProjectNames() {
  const spaces = useSpaces();
  return computed(
    () => new Map((spaces.value ?? []).flatMap((s) => s.projects.map((p) => [p.id, p.name]))),
  );
}
