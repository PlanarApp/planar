<script setup lang="ts">
import { computed, defineAsyncComponent, type Component } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  BarChart3,
  ChevronRight,
  FileText,
  Inbox,
  ListTodo,
  MessagesSquare,
} from 'lucide-vue-next';
import Badge from '../ui/Badge.vue';
import { useExtensions } from '../modules/registry';
import type { GroupScope } from '../modules/types';
import { inGroup, type InboxItem } from '../inbox/queries';
import { groupUrl, type GroupTab } from './groups';
import { sidebarCollapse as sc } from './nav';

// ветки меню группы — данные только её уровня; Задачи — только у Проекта
const props = defineProps<{ scope: GroupScope; unread: InboxItem[]; pad: string }>();
const { t } = useI18n();
const exts = useExtensions('groupTabs');
const id = computed(() =>
  props.scope.level === 'project' ? props.scope.projectId! : props.scope.spaceId,
);
const has = (tab: GroupTab) => exts.value.some((x) => x.tab === tab);
const branch = (tab: GroupTab) => exts.value.find((x) => x.tab === tab && x.branch);
const count = computed(() => props.unread.filter((n) => inGroup(n, props.scope, true)).length);
const rows = computed(() =>
  (
    [
      { tab: 'inbox', icon: Inbox, on: true },
      { tab: 'tasks', icon: ListTodo, on: props.scope.level === 'project' },
      { tab: 'docs', icon: FileText, on: has('docs') },
      { tab: 'chats', icon: MessagesSquare, on: has('chats') },
      { tab: 'reports', icon: BarChart3, on: has('reports') },
    ] as const
  ).filter((r) => r.on),
);
const key = (tab: string) => `open:${tab}:${id.value}`;
const cache = new Map<string, Component>();
const comp = (k: string, load: () => Promise<{ default: Component }>) => {
  let c = cache.get(k);
  if (!c) cache.set(k, (c = defineAsyncComponent({ loader: load, errorComponent: () => null })));
  return c;
};
const link =
  'flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md text-sm text-fg-muted hover:bg-bg-muted hover:text-fg outline-none focus-visible:ring-2 ring-focus';
</script>

<template>
  <template v-for="r in rows" :key="r.tab">
    <div class="flex items-center" :class="pad" data-testid="nav-branch">
      <button
        v-if="branch(r.tab)"
        type="button"
        class="flex size-5 shrink-0 items-center justify-center rounded text-fg-muted outline-none focus-visible:ring-2 ring-focus"
        :aria-label="t('sidebar.expand')"
        :aria-expanded="sc.is(key(r.tab))"
        @click="sc.toggle(key(r.tab))"
      >
        <ChevronRight
          :size="12"
          :class="['transition-transform', sc.is(key(r.tab)) && 'rotate-90']"
        />
      </button>
      <span v-else class="w-5 shrink-0" />
      <RouterLink
        :to="groupUrl(scope.level, id, r.tab)"
        :class="[link, 'px-1']"
        exact-active-class="bg-accent-subtle text-fg"
      >
        <component :is="r.icon" :size="14" class="shrink-0" />
        <span class="truncate">{{ t(`groups.tab.${r.tab}`) }}</span>
        <Badge
          v-if="r.tab === 'inbox' && count"
          variant="solid"
          color="var(--color-accent)"
          class="ml-auto text-accent-fg!"
          >{{ count }}</Badge
        >
      </RouterLink>
    </div>
    <div v-if="branch(r.tab) && sc.is(key(r.tab))" :class="pad">
      <component :is="comp(branch(r.tab)!.key, branch(r.tab)!.branch!)" :scope="scope" />
    </div>
  </template>
</template>
