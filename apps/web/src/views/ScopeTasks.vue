<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch, type Component } from 'vue';
import { ToolbarRoot } from 'reka-ui';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Tabs } from '../ui';
import { useSpaces } from '../tasks';
import OptionsBar from './saved/OptionsBar.vue';
import TaskModal from './TaskModal.vue';
import { buildViewTabs, useSelection, useViewOptions, viewLoaders, type Filter } from '.';

// Задачи Пространства и Воркспейса — сводка проектов группы (Список и Доска)
const props = defineProps<{ spaceId?: string; rootSpaceId?: string }>();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const spaces = useSpaces();
const scope = computed(() => {
  const ss = (spaces.value ?? []).filter((s) =>
    props.spaceId ? s.id === props.spaceId : s.id !== props.rootSpaceId,
  );
  const projectIds = ss.flatMap((s) => s.projects.map((p) => p.id));
  return {
    projectIds,
    spaceIds: ss.filter((s) => s.projects.length).map((s) => s.id),
  };
});
const key = computed(() => (props.spaceId ? `s:${props.spaceId}` : 'w'));
const tabs = computed(() =>
  buildViewTabs(viewLoaders(), []).filter((v) => ['list', 'board', 'my'].includes(v.key)),
);
const seg = computed(() => String(route.params.tab ?? ''));
const active = computed(() => tabs.value.find((v) => v.key === seg.value) ?? tabs.value[0]);
const options = useViewOptions(key, () => active.value?.key ?? 'list');
const draftFilter = ref<Filter | null>(null);
watch([key, () => active.value?.key], () => (draftFilter.value = null));
const { clear } = useSelection();
watch(key, clear, { immediate: true });

const cache = new Map<string, Component>();
const viewComponent = computed(() => {
  const a = active.value;
  if (!a) return undefined;
  if (!cache.has(a.key)) cache.set(a.key, defineAsyncComponent(a.load));
  return cache.get(a.key);
});
const selectTab = (k: string) =>
  void router.replace({
    params: { ...route.params, tab: k === 'list' ? '' : k },
    query: route.query,
  });
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <ToolbarRoot
      :aria-label="t('views.toolbar')"
      class="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2"
    >
      <div data-testid="view-tabs" class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        <Tabs
          v-if="active"
          :model-value="active.key"
          :label="t('views.toolbar')"
          :items="tabs.map((v) => ({ value: v.key, label: t(`views.${v.key}`), icon: v.icon }))"
          @update:model-value="selectTab"
        />
      </div>
      <OptionsBar
        v-model:options="options"
        v-model:filter="draftFilter"
        :space-id="scope.spaceIds.join(',')"
      />
    </ToolbarRoot>
    <div class="min-h-0 flex-1">
      <component
        :is="viewComponent"
        v-if="spaces && active"
        :key="`${key}:${active.key}`"
        :project-id="key"
        :scope="scope"
        :options="options"
        :filter="draftFilter"
      />
    </div>
    <TaskModal />
  </div>
</template>
