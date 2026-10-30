import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { useExtensions } from '../modules/registry';
import { tabsFor, type GroupLevel, type GroupTab } from './groups';

// tabs filled by modules: without the enabled module there is no tab
const MODULE_TABS: GroupTab[] = ['docs', 'chats', 'reports'];

/** Level group tabs taking enabled modules into account (group screen, breadcrumb menu). */
export function useGroupTabs(level: MaybeRefOrGetter<GroupLevel>) {
  const exts = useExtensions('groupTabs');
  return computed(() =>
    tabsFor(toValue(level)).filter(
      (k) => !MODULE_TABS.includes(k) || exts.value.some((x) => x.tab === k),
    ),
  );
}
