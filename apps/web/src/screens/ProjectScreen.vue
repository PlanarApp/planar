<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Component,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { BookmarkPlus, MoreHorizontal } from 'lucide-vue-next';
import { useProject } from '../tasks';
import { Button, Menu, Tabs, Toolbar, useBreakpoint } from '../ui';
import { useExtensions } from '../modules/registry';
import type { LocalizedText } from '../modules/types';
import {
  buildViewTabs,
  closeTask,
  taskPanelLoader,
  useSelection,
  viewLoaders,
  useViewOptions,
} from '../views';
import type { Filter } from '../views';
import { loadLayout } from '../views/table/columns';
import OptionsBar from '../views/saved/OptionsBar.vue';
import SaveViewDialog from '../views/saved/SaveViewDialog.vue';
import SavedTabs from '../views/saved/SavedTabs.vue';
import { saveView } from '../views/saved/ops';
import { useCanShare } from '../views/saved/queries';

const { t, te, locale } = useI18n();
const route = useRoute();
const router = useRouter();
const { isMobile } = useBreakpoint();

const projectId = computed(() => String(route.params.projectId));
const project = useProject(projectId);
const extViews = useExtensions('views');
const tabs = computed(() => buildViewTabs(viewLoaders(), extViews.value));
const active = computed(
  () => tabs.value.find((v) => v.key === (route.params.view || 'list')) ?? tabs.value[0],
);
const options = useViewOptions(projectId, () => active.value?.key ?? 'list');

// черновик фильтра текущего вида: сбрасывается при уходе со вкладки или из проекта
const draftFilter = ref<Filter | null>(null);
watch([projectId, () => active.value?.key], () => (draftFilter.value = null));
const spaceId = computed(() => project.value?.spaceId ?? '');
const canShare = useCanShare(spaceId);
const saveOpen = ref(false);
async function onSave(name: string, personal: boolean) {
  const id = await saveView({
    spaceId: spaceId.value,
    personal,
    name,
    layout: active.value?.key ?? 'list',
    filter: draftFilter.value,
    config:
      active.value?.key === 'table'
        ? { ...options.value, columns: loadLayout(projectId.value).columns }
        : options.value,
  });
  void router.push(`/p/${projectId.value}/v/${id}`);
}

const text = (l: LocalizedText) =>
  typeof l === 'object' ? l[locale.value as 'ru' | 'en'] : te(l) ? t(l) : l;

const cache = new Map<string, Component>();
const viewComponent = computed(() => {
  const a = active.value;
  if (!a) return undefined;
  if (!cache.has(a.key)) cache.set(a.key, defineAsyncComponent(a.load));
  return cache.get(a.key);
});

function selectTab(key: string) {
  void router.replace({ params: { ...route.params, view: key }, query: route.query });
}

const TaskPanel = taskPanelLoader && defineAsyncComponent(taskPanelLoader);
const taskKey = computed(() => (typeof route.query.task === 'string' ? route.query.task : ''));
const panelOpen = computed(() => !!TaskPanel && !!taskKey.value && !isMobile.value);

const { clear } = useSelection();
watch(projectId, clear, { immediate: true });

const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && panelOpen.value) closeTask();
};
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div v-if="project === undefined" />
  <div v-else-if="project === null" class="p-4 text-fg-muted">{{ t('views.projectNotFound') }}</div>
  <div v-else class="flex h-full min-h-0">
    <section class="flex min-w-0 flex-1 flex-col">
      <header class="flex items-baseline gap-2 px-4 pt-3">
        <h1 class="truncate text-xl font-semibold">{{ project.name }}</h1>
        <span class="text-sm text-fg-subtle">{{ project.key }}</span>
      </header>
      <div v-if="!active" class="p-4 text-fg-muted">{{ t('views.empty') }}</div>
      <template v-else>
        <Toolbar :label="t('views.toolbar')">
          <Tabs
            :model-value="active.key"
            :label="t('views.toolbar')"
            :items="tabs.map((v) => ({ value: v.key, label: text(v.label), icon: v.icon }))"
            @update:model-value="selectTab"
          />
          <SavedTabs :space-id="spaceId" :project-id="projectId" />
          <template #end>
            <OptionsBar
              v-model:options="options"
              v-model:filter="draftFilter"
              :space-id="spaceId"
              :project-id="projectId"
            >
              <Menu
                align="end"
                :items="[
                  {
                    id: 'save',
                    label: t('views.saved.save'),
                    icon: BookmarkPlus,
                    onSelect: () => (saveOpen = true),
                  },
                ]"
              >
                <template #trigger>
                  <!-- IconButton (Tooltip) теряет атрибуты триггера Menu: берём Button -->
                  <Button
                    variant="ghost"
                    size="sm"
                    :icon="MoreHorizontal"
                    :aria-label="t('views.more')"
                  />
                </template>
              </Menu>
            </OptionsBar>
          </template>
        </Toolbar>
        <SaveViewDialog v-model:open="saveOpen" :can-share="canShare" @submit="onSave" />
        <div class="min-h-0 flex-1">
          <component
            :is="viewComponent"
            :key="active.key"
            :project-id="projectId"
            :options="options"
            :filter="draftFilter"
            v-bind="active.ext ? { viewId: active.key } : {}"
          />
        </div>
      </template>
    </section>
    <aside
      v-if="panelOpen"
      class="w-[480px] shrink-0 overflow-y-auto border-l border-border bg-surface"
    >
      <component :is="TaskPanel" :task-key="taskKey" mode="panel" @close="closeTask" />
    </aside>
  </div>
</template>
