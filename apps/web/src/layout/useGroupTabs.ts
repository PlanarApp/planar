import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { useExtensions } from '../modules/registry';
import { useAuth } from '../auth/useAuth';
import { tabsFor, type GroupLevel, type GroupTab } from './groups';

// tabs filled by modules: without the enabled module there is no tab
const MODULE_TABS: GroupTab[] = ['docs', 'chats', 'reports'];

/**
 * Level group tabs taking enabled modules into account (group screen, breadcrumb menu).
 * `projectIds` — the projects of the node (C-schema v16: a data module's tab shows if it is on in one of them).
 */
export function useGroupTabs(
  level: MaybeRefOrGetter<GroupLevel>,
  projectIds?: MaybeRefOrGetter<string | string[] | undefined>,
) {
  const exts = useExtensions('groupTabs', projectIds);
  const { isAdmin } = useAuth();
  return computed(() =>
    tabsFor().filter(
      (k) =>
        (!MODULE_TABS.includes(k) || exts.value.some((x) => x.tab === k)) &&
        // Workspace settings are the instance settings — admins only (router.ts)
        (k !== 'settings' || toValue(level) !== 'workspace' || isAdmin.value),
    ),
  );
}
