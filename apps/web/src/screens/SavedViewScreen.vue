<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Check, RotateCcw } from 'lucide-vue-next';
import { useAuth } from '../auth/useAuth';
import { useProject } from '../tasks';
import { Button } from '../ui';
import { useExtensions } from '../modules/registry';
import { buildViewTabs, viewLoaders } from '../views';
import type { Filter } from '../views';
import { optionsFrom, type ViewOptions } from '../views/options';
import OptionsBar from '../views/saved/OptionsBar.vue';
import SavedTabs from '../views/saved/SavedTabs.vue';
import { updateView } from '../views/saved/ops';
import { useCanShare, useSavedView } from '../views/saved/queries';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const projectId = computed(() => String(route.params.projectId));
const viewId = computed(() => String(route.params.viewId));
const project = useProject(projectId);
const spaceId = computed(() => project.value?.spaceId ?? '');
const saved = useSavedView(viewId);
const canShare = useCanShare(spaceId);
const { user } = useAuth();
const extViews = useExtensions('views');

const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const emptyFilter = (): Filter => ({ op: 'and', rules: [] });
const fromSaved = () => {
  const v = saved.value;
  return {
    options: optionsFrom(v?.config),
    filter: ((v?.filter as Partial<Filter> | undefined)?.rules
      ? plain(v!.filter)
      : emptyFilter()) as Filter,
  };
};

// черновик: правки не пишутся, пока не нажато «Сохранить»; «Сбросить» возвращает сохранённое
const options = ref<ViewOptions>(optionsFrom(undefined));
const filter = ref<Filter | null>(emptyFilter());
const reset = () => {
  const d = fromSaved();
  options.value = d.options;
  filter.value = d.filter;
};
watch(
  () => saved.value?.id,
  () => reset(),
  { immediate: true },
);
const dirty = computed(() => {
  const d = fromSaved();
  return (
    JSON.stringify(d.options) !== JSON.stringify(options.value) ||
    JSON.stringify(d.filter) !== JSON.stringify(filter.value)
  );
});
const editable = computed(
  () =>
    !!saved.value &&
    (saved.value.userId === null ? canShare.value : saved.value.userId === user.value?.id),
);
const save = () =>
  updateView(viewId.value, { config: options.value, filter: filter.value ?? emptyFilter() });

const tab = computed(() =>
  buildViewTabs(viewLoaders(), extViews.value).find((v) => v.key === saved.value?.layout),
);
const cache = new Map<string, Component>();
const viewComponent = computed(() => {
  const a = tab.value;
  if (!a) return undefined;
  if (!cache.has(a.key)) cache.set(a.key, defineAsyncComponent(a.load));
  return cache.get(a.key);
});
</script>

<template>
  <div v-if="saved === undefined || project === undefined" />
  <div v-else-if="!saved || !project" class="p-4 text-fg-muted">
    {{ t('views.saved.notFound') }}
  </div>
  <div v-else class="flex h-full min-h-0 flex-col">
    <header class="flex items-baseline gap-2 px-4 pt-3">
      <h1 class="truncate text-xl font-semibold">{{ project.name }}</h1>
      <span class="text-sm text-fg-subtle">{{ project.key }}</span>
    </header>
    <nav class="flex gap-1 overflow-x-auto px-4 pt-2" role="tablist">
      <Button variant="ghost" @click="router.push(`/p/${projectId}`)">{{
        t('views.saved.back')
      }}</Button>
      <SavedTabs :space-id="spaceId" :project-id="projectId" :active-id="viewId" />
    </nav>
    <OptionsBar v-model:options="options" v-model:filter="filter" :space-id="spaceId">
      <template v-if="dirty">
        <Button
          v-if="editable"
          variant="primary"
          :icon="Check"
          data-testid="saved-save"
          @click="save"
        >
          {{ t('views.saved.saveChanges') }}
        </Button>
        <Button :icon="RotateCcw" data-testid="saved-reset" @click="reset">
          {{ t('views.saved.reset') }}
        </Button>
      </template>
    </OptionsBar>
    <div class="min-h-0 flex-1">
      <component
        :is="viewComponent"
        v-if="viewComponent"
        :key="saved.layout"
        :project-id="projectId"
        :options="options"
        :filter="filter"
        v-bind="tab?.ext ? { viewId: tab.key } : {}"
      />
    </div>
  </div>
</template>
