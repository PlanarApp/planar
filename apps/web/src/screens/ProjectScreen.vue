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
import { BookmarkPlus } from 'lucide-vue-next';
import { useProject } from '../tasks';
import { Button, useBreakpoint } from '../ui';
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
    config: options.value,
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
        <nav class="flex gap-1 overflow-x-auto px-4 pt-2" role="tablist">
          <button
            v-for="v in tabs"
            :key="v.key"
            role="tab"
            type="button"
            :aria-selected="v.key === active.key"
            class="inline-flex h-11 md:h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-base outline-none focus-visible:ring-2 ring-focus"
            :class="
              v.key === active.key ? 'bg-accent-subtle text-fg' : 'text-fg-muted hover:bg-bg-muted'
            "
            @click="selectTab(v.key)"
          >
            <component :is="v.icon" v-if="v.icon" :size="16" />
            {{ text(v.label) }}
          </button>
          <SavedTabs :space-id="spaceId" :project-id="projectId" />
        </nav>
        <OptionsBar v-model:options="options" v-model:filter="draftFilter" :space-id="spaceId">
          <Button :icon="BookmarkPlus" data-testid="save-as-view" @click="saveOpen = true">
            {{ t('views.saved.save') }}
          </Button>
        </OptionsBar>
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
