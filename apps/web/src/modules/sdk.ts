// SDK модулей (C-modules v4): единственная точка, откуда web-часть модуля берёт ядро.
import type { Ref } from 'vue';
import { useAuth, type User } from '../auth/useAuth';

export * from './types';
export { db, mutate, newId, rankBetween, useQuery } from '../sync';
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
export { localToday, matchFilter } from '../views/filter';

/** Текущий пользователь (null — не вошёл). */
export const useSession = (): Readonly<Ref<User | null>> => useAuth().user;
