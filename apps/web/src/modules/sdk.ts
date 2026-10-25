// SDK модулей (C-modules v4): единственная точка, откуда web-часть модуля берёт ядро.
import { computed, type Ref } from 'vue';
import { db, useQuery as liveQuery } from '../sync';
import type { FilterCtx } from '../views/filter';
import { useAuth, type User } from '../auth/useAuth';
import { useSpaces } from '../tasks';
import { i18n } from '../i18n';
import { groupLevels, type GroupLevelRow } from '../layout/groups';
import type { GroupScope } from './types';

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
export { sendTyping, onTyping } from '../sync';
export { onMutationError } from '../sync';
export { default as FilterBuilder } from '../views/saved/FilterBuilder.vue';
export { default as GroupProjectPick } from '../views/GroupProjectPick.vue';
export { localToday, matchFilter } from '../views/filter';

/** Уровни группы (свой и вложенные) для табов Документы/Чаты/Отчёты. */
export const useGroupLevels = (scope: () => GroupScope): Readonly<Ref<GroupLevelRow[]>> => {
  const spaces = useSpaces();
  return computed(() => groupLevels(scope(), spaces.value ?? [], i18n.global.t('app.name')));
};
export type { GroupLevelRow } from '../layout/groups';
export { groupUrl } from '../layout/groups';

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
