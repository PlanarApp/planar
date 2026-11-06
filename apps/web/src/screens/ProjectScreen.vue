<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch, type Component } from 'vue';
import { ToolbarRoot } from 'reka-ui';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { BookmarkPlus, Check, MoreHorizontal, RotateCcw, Users } from 'lucide-vue-next';
import { useProject } from '../tasks';
import { Button, IconButton, Menu } from '../ui';
import { useAuth } from '../auth/useAuth';
import { useExtensions } from '../modules/registry';
import type { LocalizedText } from '../modules/types';
import TaskModal from '../views/TaskModal.vue';
import { buildViewTabs, useSelection, viewLoaders } from '../views';
import { useNodeViewDraft } from '../views/saved/nodeView';
import type { Filter } from '../views';
import { loadLayout } from '../views/table/columns';
import OptionsBar from '../views/saved/OptionsBar.vue';
import ViewChangesBar from '../views/saved/ViewChangesBar.vue';
import ViewLayouts from '../views/saved/ViewLayouts.vue';
import SaveViewDialog from '../views/saved/SaveViewDialog.vue';
import SavedTabs from '../views/saved/SavedTabs.vue';
import { saveView, updateView } from '../views/saved/ops';
import { optionsFrom, type ViewOptions } from '../views/options';
import { useSidebarActions } from '../layout/sidebarActions';
import type { MenuItem } from '../ui/Menu.vue';
import { useCanShare, useSavedView } from '../views/saved/queries';

const { t, te, locale } = useI18n();
const route = useRoute();
const router = useRouter();

const projectId = computed(() => String(route.params.projectId));
const project = useProject(projectId);
const extViews = useExtensions('views', projectId);
const tabs = computed(() => buildViewTabs(viewLoaders(), extViews.value));
// saved view (/p/:projectId/v/:viewId) — a tab on a par with List and Board
const viewId = computed(() => (route.name === 'savedView' ? String(route.params.viewId) : ''));
const saved = useSavedView(viewId);
// saved view's layout draft (PLNRAPP-113): a layout pick stays in the view, '' — its own layout
const savedLayout = ref('');
const active = computed(() => {
  const key = viewId.value
    ? savedLayout.value || saved.value?.layout
    : route.params.view || 'list';
  return tabs.value.find((v) => v.key === key) ?? tabs.value[0];
});
// tab: my node view — saved to the server at once
const tabView = useNodeViewDraft({
  spaceId: () => project.value?.spaceId ?? '',
  node: () => `p:${projectId.value}`,
  layout: () => active.value?.key ?? 'list',
});

// saved view: draft — edits are not written until "Save" is pressed; "Reset" returns
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
const savedOptions = ref<ViewOptions>(optionsFrom(undefined));
const options = computed<ViewOptions>({
  get: () => (viewId.value ? savedOptions.value : tabView.options.value),
  set: (v) => (viewId.value ? (savedOptions.value = v) : (tabView.options.value = v)),
});

// saved view's filter draft — its filter; reset when the view changes
const savedFilter = ref<Filter | null>(null);
const draftFilter = computed<Filter | null>({
  get: () => (viewId.value ? savedFilter.value : tabView.filter.value),
  set: (v) => (viewId.value ? (savedFilter.value = v) : (tabView.filter.value = v)),
});
const resetSaved = () => {
  const d = viewId.value ? fromSaved() : undefined;
  if (d) savedOptions.value = d.options;
  savedFilter.value = d?.filter ?? null;
  savedLayout.value = '';
};
// a saved view's own layout pick is part of its draft — not a reason to reset it
watch(
  [projectId, () => (viewId.value ? '' : active.value?.key), viewId, () => saved.value?.id],
  resetSaved,
  { immediate: true },
);
// a named saved view only: tab edits are saved at once (tabView)
const reset = resetSaved;
const dirty = computed(() => {
  if (!viewId.value || !saved.value) return false;
  const d = fromSaved();
  return (
    (!!savedLayout.value && savedLayout.value !== saved.value.layout) ||
    JSON.stringify(d.options) !== JSON.stringify(savedOptions.value) ||
    JSON.stringify(d.filter) !== JSON.stringify(savedFilter.value)
  );
});
const spaceId = computed(() => project.value?.spaceId ?? '');
const canShare = useCanShare(spaceId);
const { user } = useAuth();
// a tab's view is always my own
const editable = computed(
  () =>
    !viewId.value ||
    (!!saved.value &&
      (saved.value.userId === null ? canShare.value : saved.value.userId === user.value?.id)),
);
const saveChanges = () =>
  updateView(viewId.value, {
    layout: active.value?.key,
    config: savedOptions.value,
    filter: savedFilter.value ?? emptyFilter(),
  });
const saveOpen = ref(false);
// project "…" menu: save view + project actions (as in the sidebar, without inline renaming)
const projectActions = useSidebarActions().projectItems;
const headerMenu = computed<MenuItem[]>(() => [
  {
    id: 'save',
    label: t('views.saved.save'),
    icon: BookmarkPlus,
    onSelect: () => (saveOpen.value = true),
  },
  { separator: true },
  ...(project.value
    ? projectActions({
        id: project.value.id,
        name: project.value.name,
        prefix: project.value.key,
        color: project.value.color ?? null,
        icon: project.value.icon ?? null,
      }).filter((it) => !('id' in it) || it.id !== 'rename')
    : []),
]);
async function onSave(name: string, personal: boolean, icon: string) {
  const id = await saveView({
    spaceId: spaceId.value,
    personal,
    name,
    icon,
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
  void router.replace({
    name: 'project',
    params: { projectId: projectId.value, view: key },
    query: route.query,
  });
}

const { clear } = useSelection();
watch(projectId, clear, { immediate: true });

// tab strip: on overflow — a gradient mask at the edge where there is hidden content
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
  const g = `linear-gradient(to right, ${l ? 'transparent, #000 40px' : '#000, #000'}, ${r ? '#000 calc(100% - 40px), transparent' : '#000, #000'})`;
  return { maskImage: g, WebkitMaskImage: g };
});
let ro: ResizeObserver | undefined;
watch(strip, (el) => {
  ro?.disconnect();
  if (el && typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(measure);
    ro.observe(el);
    // scrollWidth grows without the strip itself resizing (saved views, font) — we watch the children too
    for (const c of el.children) ro.observe(c);
  }
  measure();
});
onBeforeUnmount(() => ro?.disconnect());
</script>

<template>
  <div v-if="project === undefined" />
  <div v-else-if="project === null" class="p-4 text-fg-muted">{{ t('views.projectNotFound') }}</div>
  <div v-else class="flex h-full min-h-0">
    <section class="flex min-w-0 flex-1 flex-col">
      <div v-if="viewId && saved === undefined" />
      <div v-else-if="viewId && !saved" class="p-4 text-fg-muted">
        {{ t('views.saved.notFound') }}
      </div>
      <div v-else-if="!active" class="p-4 text-fg-muted">{{ t('views.empty') }}</div>
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
            <SavedTabs
              :space-id="spaceId"
              :project-id="projectId"
              :active-id="viewId || undefined"
            />
          </div>
          <div class="flex shrink-0 items-center gap-1 max-md:gap-0">
            <OptionsBar
              v-model:options="options"
              v-model:filter="draftFilter"
              :space-id="spaceId"
              :project-id="projectId"
            >
              <!-- in a saved view a pick changes its layout (draft, «Save» keeps it) — PLNRAPP-113 -->
              <template #layout>
                <ViewLayouts
                  :model-value="active.key"
                  :items="tabs.map((v) => ({ value: v.key, label: text(v.label), icon: v.icon }))"
                  @update:model-value="(k) => (viewId ? (savedLayout = k) : selectTab(k))"
                />
              </template>
              <Menu align="end" :items="headerMenu">
                <template #trigger>
                  <IconButton
                    size="sm"
                    :icon="MoreHorizontal"
                    :label="t('views.more')"
                    class="max-md:w-7"
                  />
                </template>
              </Menu>
            </OptionsBar>
          </div>
        </ToolbarRoot>
        <ViewChangesBar
          v-slot="{ hide }"
          :show="viewId ? dirty : tabView.hasPersonal.value"
          :state="[options, draftFilter]"
        >
          <template v-if="!viewId">
            <!-- my version is already kept (personal row): «себе» confirms it, «для всех» — admins only -->
            <Button size="sm" :icon="Check" compact data-testid="node-keep" @click="hide">
              {{ t('views.saved.saveForMe') }}
            </Button>
            <Button
              v-if="canShare"
              size="sm"
              :icon="Users"
              compact
              data-testid="node-share"
              @click="tabView.saveForAll"
            >
              {{ t('views.saved.saveForAll') }}
            </Button>
            <Button
              size="sm"
              :icon="RotateCcw"
              compact
              data-testid="node-reset"
              @click="tabView.reset"
            >
              {{ t('views.saved.reset') }}
            </Button>
          </template>
          <template v-else>
            <Button
              v-if="editable"
              variant="primary"
              size="sm"
              :icon="Check"
              compact
              data-testid="saved-save"
              @click="saveChanges"
            >
              {{ t('views.saved.saveChanges') }}
            </Button>
            <Button size="sm" :icon="RotateCcw" compact data-testid="saved-reset" @click="reset">
              {{ t('views.saved.reset') }}
            </Button>
          </template>
        </ViewChangesBar>
        <SaveViewDialog v-model:open="saveOpen" :can-share="canShare" @submit="onSave" />
        <div class="min-h-0 flex-1">
          <component
            :is="viewComponent"
            :key="viewId || active.key"
            :project-id="projectId"
            :options="options"
            :filter="draftFilter"
            v-bind="{
              ...(active.ext ? { viewId: active.key } : {}),
              ...(viewId
                ? { saved: true, 'onUpdate:options': (o: ViewOptions) => (options = o) }
                : {}),
            }"
          />
        </div>
      </template>
    </section>
    <TaskModal />
  </div>
</template>
