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
import { ToolbarRoot } from 'reka-ui';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { BookmarkPlus, MoreHorizontal } from 'lucide-vue-next';
import { useProject } from '../tasks';
import { IconButton, Menu, Tabs, useBreakpoint } from '../ui';
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

// полоса вкладок: при переполнении — градиентная маска у края, где есть скрытое
const strip = ref<HTMLElement>();
const fade = ref({ l: false, r: false });
const measure = () => {
  const el = strip.value;
  if (el)
    fade.value = {
      l: el.scrollLeft > 1,
      r: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    };
};
const stripMask = computed(() => {
  const { l, r } = fade.value;
  if (!l && !r) return undefined;
  const g = `linear-gradient(to right, ${l ? 'transparent, #000 24px' : '#000, #000'}, ${r ? '#000 calc(100% - 24px), transparent' : '#000, #000'})`;
  return { maskImage: g, WebkitMaskImage: g };
});
let ro: ResizeObserver | undefined;
watch(strip, (el) => {
  ro?.disconnect();
  if (el && typeof ResizeObserver !== 'undefined') (ro = new ResizeObserver(measure)).observe(el);
  measure();
});
onBeforeUnmount(() => ro?.disconnect());

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
        <ToolbarRoot
          :aria-label="t('views.toolbar')"
          class="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2"
        >
          <div
            ref="strip"
            data-testid="view-tabs"
            class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap"
            :style="stripMask"
            @scroll.passive="measure"
          >
            <Tabs
              :model-value="active.key"
              :label="t('views.toolbar')"
              :items="tabs.map((v) => ({ value: v.key, label: text(v.label), icon: v.icon }))"
              @update:model-value="selectTab"
            />
            <SavedTabs :space-id="spaceId" :project-id="projectId" />
          </div>
          <div class="flex shrink-0 items-center gap-1">
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
                  <IconButton size="sm" :icon="MoreHorizontal" :label="t('views.more')" />
                </template>
              </Menu>
            </OptionsBar>
          </div>
        </ToolbarRoot>
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
