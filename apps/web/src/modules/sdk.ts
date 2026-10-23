// SDK модулей (C-modules v4): единственная точка, откуда web-часть модуля берёт ядро.
import { computed, type Ref } from 'vue';
import { db, useQuery as liveQuery } from '../sync';
import type { FilterCtx } from '../views/filter';
import { useAuth, type User } from '../auth/useAuth';

export * from './types';
export { mutate, newId, rankBetween, useQuery } from '../sync';
export { db };
export {
  useTask,
  useProjectTasks,
  useSpaces,
  useProject,
  useStatuses,
  useMembers,
  useLabels,
} from '../tasks';
export type { TaskView } from '../tasks';
export { openTask } from '../views/open';
export * from '../ui';
export { useI18n } from 'vue-i18n';
export { i18n } from '../i18n';
export { useWeekStart } from '../i18n/week';
export { useRouter } from 'vue-router';
export { useSearch } from '../command/search';
export { default as Editor } from '../task/editor/Editor.vue';
export { uploadFile, type Uploaded } from '../api/files';
export { api, ApiError } from '../api/http';
export { onMutationError } from '../sync';
export { default as FilterBuilder } from '../views/saved/FilterBuilder.vue';
export { localToday, matchFilter } from '../views/filter';

/** Текущий пользователь (null — не вошёл). */
export const useSession = (): Readonly<Ref<User | null>> => useAuth().user;

/** Циклы (по проекту или все) для `FilterCtx.cycles`; пусто, если модуль sprints не подключён. */
export const useCycles = (projectId?: string): Readonly<Ref<NonNullable<FilterCtx['cycles']>>> => {
  const r = liveQuery(async () => {
    if (!db.tables.some((t) => t.name === 'sprintsCycles')) return [];
    const t = db.table('sprintsCycles');
    return (
      projectId ? await t.where('projectId').equals(projectId).toArray() : await t.toArray()
    ) as NonNullable<FilterCtx['cycles']>;
  });
  return computed(() => r.value ?? []);
};
