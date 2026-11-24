// Module SDK (C-modules v4): the single point from which a module's web part takes the core.
import { computed, defineAsyncComponent, type Ref } from 'vue';
import { db, useQuery as liveQuery } from '../sync';
import type { FilterCtx } from '../views/filter';
import { useAuth, type User } from '../auth/useAuth';
import { useSpaces, useWorkspace } from '../tasks';
import { groupLevels, type GroupLevelRow } from '../layout/groups';
import type { GroupScope } from './types';

export * from './types';
export { mutate, newId, rankBetween, useQuery } from '../sync';
/** Is the data module on for the project (C-schema v16); in summaries — for the projects of the scope. */
export { enabledForProject, useExtensions } from './registry';
/** PLNRAPP-202: the indicator of background work (C-modules v15) */
export {
  useActivity,
  activityOf,
  minutesSince,
  useNow,
  TASK_ACTIVITY,
  type Activity,
} from './activity';
/** PLNRAPP-251: a replica query with a reactive argument (C-modules v16) */
export { useLive } from '../links/live';
export { db };
export {
  useTask,
  useProjectTasks,
  useScopeTasks,
  useSpaces,
  useProject,
  useStatuses,
  useMembers,
  useLabels,
  useProjectAdmin,
  AssigneePicker,
  StatusesPicker,
} from '../tasks';
export type { TaskView } from '../tasks';
export { openTask } from '../views/open';
/** PLNRAPP-519: the "Move to project" submenu — spaces → projects I can change */
export { moveMenu, useMoveSpaces, type MoveSpace } from '../tasks/moveTargets';
export * from '../ui';
/** PLNRAPP-831: a short notice («Link copied») */
export { toast } from '../ui/toast';
export * from '../pickers';
export { useI18n } from 'vue-i18n';
export { i18n } from '../i18n';
export { useWeekStart } from '../i18n/week';
export { useRouter } from 'vue-router';
export { useSearch } from '../command/search';
export { default as Editor } from '../task/editor/Editor.vue';
export { slashItems, filterSlash, type SlashItem } from '../task/editor/slash';
/** PLNRAPP-833: @@ — link to a task, @@@ — to a document; the dialog is a separate chunk, as in Editor */
export { refTrigger, insertRefAt, type RefAt } from '../task/editor/refTrigger';
export type { RefPick } from '../task/editor/RefPicker.vue';
export const RefPicker = defineAsyncComponent(() => import('../task/editor/RefPicker.vue'));
export { uploadFile, type Uploaded } from '../api/files';
export { api, ApiError } from '../api/http';
export { sendTyping, onTyping, onReplicaChange } from '../sync';
export { onMutationError } from '../sync';
export { default as FilterBuilder } from '../views/saved/FilterBuilder.vue';
export { default as GroupProjectPick } from '../views/GroupProjectPick.vue';
export { default as PlanPanel } from '../views/PlanPanel.vue';
export { favorites, type FavRef } from '../layout/nav';
export { localToday, matchFilter } from '../views/filter';
export { widenByName } from '../views/scope';

/** Group levels (own and nested) for the Documents/Chats/Reports tabs. */
export const useGroupLevels = (scope: () => GroupScope): Readonly<Ref<GroupLevelRow[]>> => {
  const spaces = useSpaces();
  const ws = useWorkspace();
  return computed(() => groupLevels(scope(), spaces.value ?? [], ws.value.name));
};
export type { GroupLevelRow } from '../layout/groups';
export { groupUrl } from '../layout/groups';

/** Current user (null — not logged in). */
export const useSession = (): Readonly<Ref<User | null>> => useAuth().user;

/** Cycles (per project or all) for `FilterCtx.cycles`; empty if the sprints module is not connected. */
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
