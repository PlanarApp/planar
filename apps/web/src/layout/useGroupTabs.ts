import { computed, toValue, type MaybeRefOrGetter } from 'vue';
import { useExtensions } from '../modules/registry';
import { tabsFor, type GroupLevel, type GroupTab } from './groups';

// табы, наполняемые модулями: без включённого модуля таба нет
const MODULE_TABS: GroupTab[] = ['docs', 'chats', 'reports'];

/** Табы группы уровня с учётом включённых модулей (экран группы, меню крошек). */
export function useGroupTabs(level: MaybeRefOrGetter<GroupLevel>) {
  const exts = useExtensions('groupTabs');
  return computed(() =>
    tabsFor(toValue(level)).filter(
      (k) => !MODULE_TABS.includes(k) || exts.value.some((x) => x.tab === k),
    ),
  );
}
