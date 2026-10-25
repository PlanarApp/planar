<script setup lang="ts">
import { computed, defineAsyncComponent, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { BarChart3, FileText, Inbox, ListTodo, MessagesSquare, Settings } from 'lucide-vue-next';
import { useProject, useRootSpaceId, useSpaces } from '../tasks';
import { EmptyState, Tabs } from '../ui';
import { useExtensions } from '../modules/registry';
import type { GroupScope, LocalizedText } from '../modules/types';
import { GROUP_TABS, groupTab, groupUrl, type GroupLevel } from '../layout/groups';
import ProjectScreen from './ProjectScreen.vue';
import ScopeTasks from '../views/ScopeTasks.vue';
import SettingsScreen from './SettingsScreen.vue';
import InboxScreen from './InboxScreen.vue';

// Группа: Воркспейс (/w), Пространство (/s/:spaceId), Проект (/p/:projectId) — одинаковые табы
const { t, te, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const level = computed<GroupLevel>(() =>
  route.name === 'project' ? 'project' : route.name === 'space' ? 'space' : 'workspace',
);
const id = computed(() =>
  String(level.value === 'project' ? route.params.projectId : (route.params.spaceId ?? '')),
);
const tab = computed(() => groupTab(route.params.view ?? route.params.tab));
const project = useProject(() => (level.value === 'project' ? id.value : ''));
const spaces = useSpaces();
const rootId = useRootSpaceId();
const name = computed(() =>
  level.value === 'project'
    ? project.value?.name
    : level.value === 'space'
      ? spaces.value?.find((s) => s.id === id.value)?.name
      : t('app.name'),
);
const scope = computed<GroupScope | null>(() => {
  const root = rootId.value;
  if (!root) return null;
  if (level.value === 'project')
    return project.value
      ? { level: 'project', spaceId: project.value.spaceId, projectId: id.value, rootSpaceId: root }
      : null;
  return {
    level: level.value,
    spaceId: level.value === 'space' ? id.value : root,
    projectId: null,
    rootSpaceId: root,
  };
});
// таб модулей: несколько вкладов (Отчёты) — подтабы, выбранный в ?r
const exts = useExtensions('groupTabs');
const parts = computed(() => exts.value.filter((x) => x.tab === tab.value));
const part = computed(() => parts.value.find((x) => x.key === route.query.r) ?? parts.value[0]);
const text = (l: LocalizedText) =>
  typeof l === 'object' ? l[locale.value as 'ru' | 'en'] : te(l) ? t(l) : l;
const cache = new Map<string, Component>();
const partComponent = computed(() => {
  const p = part.value;
  if (!p) return undefined;
  if (!cache.has(p.key)) cache.set(p.key, defineAsyncComponent(p.component));
  return cache.get(p.key);
});
const selectPart = (k: string) => void router.replace({ query: { ...route.query, r: k } });
const icons = {
  inbox: Inbox,
  tasks: ListTodo,
  docs: FileText,
  chats: MessagesSquare,
  reports: BarChart3,
  settings: Settings,
};
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header v-if="name" class="flex items-baseline gap-2 px-4 pt-3">
      <h1 class="truncate text-xl font-semibold">{{ name }}</h1>
      <span v-if="level === 'project'" class="text-sm text-fg-subtle">{{ project?.key }}</span>
    </header>
    <nav
      v-if="name"
      :aria-label="t('groups.tabs')"
      data-testid="group-tabs"
      class="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2"
    >
      <RouterLink
        v-for="k in GROUP_TABS"
        :key="k"
        :to="groupUrl(level, id, k)"
        :aria-current="tab === k ? 'page' : undefined"
        :class="[
          'inline-flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-2 text-sm font-medium outline-none focus-visible:outline-2 focus-visible:outline-focus md:h-9',
          tab === k ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
        ]"
      >
        <component :is="icons[k]" :size="16" aria-hidden="true" />{{ t(`groups.tab.${k}`) }}
      </RouterLink>
    </nav>
    <div class="min-h-0 flex-1">
      <ProjectScreen v-if="level === 'project' && tab === 'tasks'" />
      <ScopeTasks
        v-else-if="name && tab === 'tasks'"
        :space-id="level === 'space' ? id : undefined"
        :root-space-id="rootId ?? undefined"
      />
      <SettingsScreen v-else-if="name && scope && tab === 'settings'" :scope="scope" />
      <InboxScreen
        v-else-if="name && scope && tab === 'inbox'"
        :scope="scope"
        class="h-full overflow-y-auto"
      />
      <div v-else-if="name && scope && part" class="flex h-full min-h-0 flex-col">
        <div v-if="parts.length > 1" class="shrink-0 border-b border-border px-2 py-1">
          <Tabs
            :model-value="part.key"
            :label="t(`groups.tab.${tab}`)"
            :items="
              parts.map((x) => ({
                value: x.key,
                label: x.label ? text(x.label) : x.id,
                icon: x.icon,
              }))
            "
            @update:model-value="selectPart"
          />
        </div>
        <component :is="partComponent" :key="part.key" :scope="scope" class="min-h-0 flex-1" />
      </div>
      <EmptyState
        v-else-if="name"
        :icon="icons[tab]"
        :title="t(`groups.tab.${tab}`)"
        :description="t('groups.soon')"
      />
      <ProjectScreen v-else-if="level === 'project'" />
    </div>
  </div>
</template>
