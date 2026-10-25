<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { BarChart3, FileText, Inbox, ListTodo, MessagesSquare, Settings } from 'lucide-vue-next';
import { useProject, useSpaces } from '../tasks';
import { EmptyState } from '../ui';
import { GROUP_TABS, groupTab, groupUrl, type GroupLevel } from '../layout/groups';
import ProjectScreen from './ProjectScreen.vue';

// Группа: Воркспейс (/w), Пространство (/s/:spaceId), Проект (/p/:projectId) — одинаковые табы
const { t } = useI18n();
const route = useRoute();
const level = computed<GroupLevel>(() =>
  route.name === 'project' ? 'project' : route.name === 'space' ? 'space' : 'workspace',
);
const id = computed(() =>
  String(level.value === 'project' ? route.params.projectId : (route.params.spaceId ?? '')),
);
const tab = computed(() => groupTab(route.params.view ?? route.params.tab));
const project = useProject(() => (level.value === 'project' ? id.value : ''));
const spaces = useSpaces();
const name = computed(() =>
  level.value === 'project'
    ? project.value?.name
    : level.value === 'space'
      ? spaces.value?.find((s) => s.id === id.value)?.name
      : t('app.name'),
);
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
