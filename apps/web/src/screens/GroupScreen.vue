<script setup lang="ts">
import { computed, defineAsyncComponent, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  BarChart3,
  Briefcase,
  Check,
  ChevronDown,
  FolderKanban,
  LayoutGrid,
  FileText,
  ListTodo,
  MessagesSquare,
  Settings,
} from 'lucide-vue-next';
import { useProject, useRootSpaceId, useSpaces, useWorkspace } from '../tasks';
import { EmptyState, Menu, Tabs, type MenuItem } from '../ui';
import { useExtensions } from '../modules/registry';
import type { GroupScope, LocalizedText } from '../modules/types';
import { groupTab, groupUrl, lastTab, tabsFor, type GroupLevel } from '../layout/groups';
import { WORK_SUBS, workSub } from '../inbox/subs';
import { useGroupTabs } from '../layout/useGroupTabs';
import GroupList from './GroupList.vue';
import ProjectScreen from './ProjectScreen.vue';
import ScopeTasks from '../views/ScopeTasks.vue';
import SettingsScreen from './SettingsScreen.vue';
import MyWork from '../inbox/MyWork.vue';
import TaskModal from '../views/TaskModal.vue';

// Group: Workspace (/w), Space (/s/:spaceId), Project (/p/:projectId) — the same tabs
const { t, te, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const level = computed<GroupLevel>(() =>
  route.name === 'project' || route.name === 'savedView'
    ? 'project'
    : route.name === 'space'
      ? 'space'
      : 'workspace',
);
const id = computed(() =>
  String(level.value === 'project' ? route.params.projectId : (route.params.spaceId ?? '')),
);
const tabs = useGroupTabs(level);
const tab = computed(() => groupTab(route.params.view ?? route.params.tab));
const project = useProject(() => (level.value === 'project' ? id.value : ''));
const spaces = useSpaces();
const rootId = useRootSpaceId();
const ws = useWorkspace();
const name = computed(() =>
  level.value === 'project'
    ? project.value?.name
    : level.value === 'space'
      ? spaces.value?.find((s) => s.id === id.value)?.name
      : ws.value.name,
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
// module tab: several contributions (Reports) — sub-tabs, the selected one in ?r
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
// "My work" sections: the current one is marked
const workItems = computed<MenuItem[]>(() =>
  WORK_SUBS.map((w) => ({
    id: w,
    label: t(`work.${w}`),
    icon: tab.value === 'work' && workSub(route.query.w) === w ? Check : undefined,
    onSelect: () =>
      void router.push({ path: groupUrl(level.value, id.value, 'work'), query: { w } }),
  })),
);
// the tab and the view are remembered for any node; a tab missing at the level (Spaces, Projects) — "My work".
// Module tabs are not checked: on a cold start modules are not known yet
const seg = computed(() => String(route.params.view ?? route.params.tab ?? ''));
watch(
  [seg, () => route.query.w],
  ([s, w]) => {
    if (!s || route.name === 'savedView') return;
    if (!tabsFor(level.value).includes(tab.value)) {
      void router.replace(groupUrl(level.value, id.value, 'work'));
      return;
    }
    lastTab.set(s === 'work' && typeof w === 'string' ? { seg: s, w } : { seg: s });
  },
  { immediate: true },
);
const icons = {
  work: Briefcase,
  spaces: LayoutGrid,
  projects: FolderKanban,
  tasks: ListTodo,
  docs: FileText,
  chats: MessagesSquare,
  reports: BarChart3,
  settings: Settings,
};
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <nav
      v-if="name"
      :aria-label="t('groups.tabs')"
      data-testid="group-tabs"
      class="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2"
    >
      <template v-for="k in tabs" :key="k">
        <RouterLink
          :to="groupUrl(level, id, k)"
          :aria-current="tab === k ? 'page' : undefined"
          :class="[
            'inline-flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-2 text-sm font-medium outline-none focus-visible:outline-2 focus-visible:outline-focus md:h-9',
            tab === k ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
          ]"
        >
          <component :is="icons[k]" :size="16" aria-hidden="true" />
          <!-- мобильная: подпись только у текущей вкладки -->
          <span :class="tab !== k && 'max-md:sr-only'"
            >{{ t(`groups.tab.${k}`)
            }}<template v-if="k === 'work' && tab === 'work'">
              · {{ t(`work.${workSub(route.query.w)}`) }}</template
            ></span
          >
        </RouterLink>
        <!-- разделы «Моей работы» — меню справа от вкладки -->
        <Menu v-if="k === 'work'" :items="workItems" align="start">
          <template #trigger>
            <button
              type="button"
              :aria-label="t('work.title')"
              data-testid="work-menu"
              class="-ml-1 inline-flex h-11 shrink-0 items-center rounded-md px-1 text-fg-muted outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-focus md:h-9"
            >
              <ChevronDown :size="14" />
            </button>
          </template>
        </Menu>
      </template>
    </nav>
    <div class="min-h-0 flex-1">
      <ProjectScreen v-if="level === 'project' && tab === 'tasks'" />
      <ScopeTasks
        v-else-if="name && tab === 'tasks'"
        :space-id="level === 'space' ? id : undefined"
        :root-space-id="rootId ?? undefined"
      />
      <SettingsScreen v-else-if="name && scope && tab === 'settings'" :scope="scope" />
      <MyWork v-else-if="name && scope && tab === 'work'" :scope="scope" />
      <GroupList
        v-else-if="name && scope && (tab === 'spaces' || tab === 'projects') && level !== 'project'"
        :scope="scope"
        :kind="tab"
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
    <!-- в Задачах окно задачи рисует сам вид (ProjectScreen, ScopeTasks) -->
    <TaskModal v-if="tab !== 'tasks'" />
  </div>
</template>
