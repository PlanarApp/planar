import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { useExtensions } from '../modules/registry';
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
  return computed(() =>
    tabsFor(toValue(level)).filter(
      (k) => !MODULE_TABS.includes(k) || exts.value.some((x) => x.tab === k),
    ),
  );
}
