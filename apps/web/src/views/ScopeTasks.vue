<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch, watchEffect, type Component } from 'vue';
import { ToolbarRoot } from 'reka-ui';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Select, Tabs } from '../ui';
import { useSpaces } from '../tasks';
import OptionsBar from './saved/OptionsBar.vue';
import TaskModal from './TaskModal.vue';
import { buildViewTabs, useSelection, useViewOptions, viewLoaders, type Filter } from '.';
import type { MeMode } from './saved/useFilter';

// Задачи Пространства и Воркспейса — сводка проектов группы (Список и Доска).
// me — вид в «Моей работе» (назначенные, созданные, отслеживаемые) любой группы, и проекта тоже:
// Me Mode задан, вид — в ?v, а не в адресе таба
const props = defineProps<{
  spaceId?: string;
  rootSpaceId?: string;
  projectId?: string;
  me?: MeMode;
}>();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const spaces = useSpaces();
const scope = computed(() => {
  const ss = (spaces.value ?? []).filter((s) =>
    props.projectId
      ? s.projects.some((p) => p.id === props.projectId)
      : props.spaceId
        ? s.id === props.spaceId
        : s.id !== props.rootSpaceId,
  );
  const projectIds = props.projectId
    ? [props.projectId]
    : ss.flatMap((s) => s.projects.map((p) => p.id));
  const target = ss
    .flatMap((s) => s.projects.map((p) => ({ p, s })))
    .find((x) => x.p.id === createIn.value);
  return {
    projectIds,
    spaceIds: ss.filter((s) => s.projects.length).map((s) => s.id),
    ...(target && { createIn: { projectId: target.p.id, spaceId: target.s.id } }),
  };
});
const key = computed(
  () =>
    (props.projectId ? `p:${props.projectId}` : props.spaceId ? `s:${props.spaceId}` : 'w') +
    (props.me ? `:me-${props.me}` : ''),
);
// проект для новых задач сводки — выбор в панели (запоминается на сводку); по умолчанию первый
const projectOptions = computed(() =>
  (spaces.value ?? []).flatMap((s) =>
    s.projects
      .filter((p) => !props.projectId || p.id === props.projectId)
      .filter((p) => (props.spaceId ? s.id === props.spaceId : s.id !== props.rootSpaceId))
      .map((p) => ({ value: p.id, label: p.name })),
  ),
);
const createKey = () => `planar.scope.${key.value}.createIn`;
const picked = ref<string | null>(null);
watch(
  () => key.value,
  () => {
    try {
      picked.value = localStorage.getItem(createKey());
    } catch {
      picked.value = null;
    }
  },
  { immediate: true },
);
const createIn = computed({
  get: () =>
    projectOptions.value.find((o) => o.value === picked.value)?.value ??
    projectOptions.value[0]?.value ??
    null,
  set: (v: string | null) => {
    picked.value = v;
    try {
      if (v) localStorage.setItem(createKey(), v);
    } catch {
      /* без хранилища — до перезагрузки */
    }
  },
});
const tabs = computed(() =>
  buildViewTabs(viewLoaders(), []).filter((v) => ['list', 'board'].includes(v.key)),
);
const seg = computed(() => String((props.me ? route.query.v : route.params.tab) ?? ''));
const active = computed(() => tabs.value.find((v) => v.key === seg.value) ?? tabs.value[0]);
const options = useViewOptions(key, () => active.value?.key ?? 'list');
// у «Моей работы» свой ключ опций — Me Mode в нём закреплён
watchEffect(() => {
  if (props.me && options.value.me !== props.me) options.value.me = props.me;
});
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
  void router.replace(
    props.me
      ? { query: { ...route.query, v: k } }
      : { params: { ...route.params, tab: k === 'list' ? '' : k }, query: route.query },
  );
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
      <Select
        v-if="projectOptions.length > 1"
        v-model="createIn"
        size="sm"
        :label="t('views.createIn')"
        :options="projectOptions"
        class="w-48"
        data-testid="create-in"
      />
      <OptionsBar
        v-model:options="options"
        :no-me="!!me"
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
    <!-- в «Моей работе» окно задачи рисует экран группы -->
    <TaskModal v-if="!me" />
  </div>
</template>
