<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch, type Component } from 'vue';
import { ToolbarRoot } from 'reka-ui';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Check, RotateCcw, Users } from 'lucide-vue-next';
import { Button } from '../ui';
import ProjectFilter from './ProjectFilter.vue';
import { useExtensions } from '../modules/registry';
import type { LocalizedText } from '../modules/types';
import { useSpaces } from '../tasks';
import { useAuth } from '../auth/useAuth';
import OptionsBar from './saved/OptionsBar.vue';
import ViewChangesBar from './saved/ViewChangesBar.vue';
import ViewLayouts from './saved/ViewLayouts.vue';
import TaskModal from './TaskModal.vue';
import { buildViewTabs, useSelection, viewLoaders } from '.';
import type { MeMode } from './saved/useFilter';
import { useNodeViewDraft } from './saved/nodeView';
import { useCanShare } from './saved/queries';

// Tasks of a Space and of the Workspace — the group's project summary (List and Board).
// me — the view "My work" (assigned, created, watched) of any group, and of a project too:
// Me Mode is set, the view — in ?v, not in the tab address; the left of the toolbar — the "My work"
// section tabs (slot tabs); day — the «My day» planner above the view. The view is picked in the «View» menu (PLNRAPP-71)
const props = defineProps<{
  spaceId?: string;
  rootSpaceId?: string;
  projectId?: string;
  me?: MeMode;
  day?: boolean;
}>();
const { t, te, locale } = useI18n();
const text = (l: LocalizedText) =>
  typeof l === 'object' ? l[locale.value as 'ru' | 'en'] : te(l) ? t(l) : l;
const route = useRoute();
const router = useRouter();
const spaces = useSpaces();
const { user } = useAuth();
const scope = computed(() => {
  const ss = (spaces.value ?? []).filter((s) =>
    props.projectId
      ? s.projects.some((p) => p.id === props.projectId)
      : props.spaceId
        ? s.id === props.spaceId
        : s.id !== props.rootSpaceId,
  );
  // project filter: nothing selected — all projects of the group
  const all = ss.flatMap((s) => s.projects.map((p) => ({ p, s })));
  const shown = props.projectId
    ? all.filter((x) => x.p.id === props.projectId)
    : picked.value.length
      ? all.filter((x) => picked.value.includes(x.p.id))
      : all;
  // creation — when there is one project (otherwise it is unclear where)
  const target = shown.length === 1 ? shown[0] : undefined;
  return {
    projectIds: shown.map((x) => x.p.id),
    spaceIds: [...new Set(shown.map((x) => x.s.id))],
    ...(target && { createIn: { projectId: target.p.id, spaceId: target.s.id } }),
    ...(props.me && user.value && { createAssigneeId: user.value.id }),
  };
});
const key = computed(
  () =>
    (props.projectId ? `p:${props.projectId}` : props.spaceId ? `s:${props.spaceId}` : 'w') +
    (props.me ? `:me-${props.me}` : ''),
);
// selected summary projects (remembered per summary)
const projectOptions = computed(() =>
  (spaces.value ?? []).flatMap((s) =>
    s.projects
      .filter((p) => !props.projectId || p.id === props.projectId)
      .filter((p) => (props.spaceId ? s.id === props.spaceId : s.id !== props.rootSpaceId))
      // across spaces same-named projects are told apart by the space, as in quick create
      .map((p) => ({ value: p.id, label: props.spaceId ? p.name : `${s.name} / ${p.name}` })),
  ),
);
const pickKey = () => `planar.scope.${key.value}.projects`;
const stored = ref<string[]>([]);
watch(
  () => key.value,
  () => {
    try {
      const v = JSON.parse(localStorage.getItem(pickKey()) ?? '[]');
      stored.value = Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    } catch {
      stored.value = [];
    }
  },
  { immediate: true },
);
// deleted / foreign projects are ignored in the remembered selection
const picked = computed({
  get: () => stored.value.filter((id) => projectOptions.value.some((o) => o.value === id)),
  set: (v: string[]) => {
    stored.value = v;
    try {
      localStorage.setItem(pickKey(), JSON.stringify(v));
    } catch {
      /* no storage — until reload */
    }
  },
});
// built-in views and module views that support a summary (Timeline)
const extViews = useExtensions('views');
const tabs = computed(() =>
  buildViewTabs(
    viewLoaders(),
    extViews.value.filter((e) => e.scope),
  ).filter((v) => v.ext || ['list', 'board', 'table', 'calendar'].includes(v.key)),
);
const seg = computed(() => String((props.me ? route.query.v : route.params.tab) ?? ''));
const active = computed(() => tabs.value.find((v) => v.key === seg.value) ?? tabs.value[0]);
// «My day» planner (PLANARAPP-57) with the project filter of the view; async — inbox imports views
const MyDay = defineAsyncComponent(() => import('../inbox/MyDay.vue'));
const tabItems = computed(() =>
  tabs.value.map((v) => ({ value: v.key, label: text(v.label), icon: v.icon })),
);
const nodeSpaceId = () =>
  props.spaceId ??
  (props.projectId
    ? (spaces.value ?? []).find((s) => s.projects.some((p) => p.id === props.projectId))?.id
    : props.rootSpaceId) ??
  '';
const canShare = useCanShare(nodeSpaceId);
// node view: saved to my row at once; "My work" has its own key — Me Mode is fixed in it
const view = useNodeViewDraft({
  spaceId: nodeSpaceId,
  node: key,
  layout: () => active.value?.key ?? 'list',
  notProject: true,
  fixed: () => (props.me ? { me: props.me } : {}),
});
const { options, filter: draftFilter } = view;
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
      : { params: { ...route.params, tab: k }, query: route.query },
  );
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <ToolbarRoot
      :aria-label="t('views.toolbar')"
      class="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2"
    >
      <div data-testid="view-tabs" class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        <slot v-if="me" name="tabs" />
      </div>
      <ProjectFilter v-if="projectOptions.length > 1" v-model="picked" :options="projectOptions" />
      <OptionsBar
        v-model:options="options"
        :no-me="!!me"
        v-model:filter="draftFilter"
        :space-id="scope.spaceIds.join(',')"
      >
        <template v-if="active" #layout>
          <ViewLayouts
            :model-value="active.key"
            :items="tabItems"
            @update:model-value="selectTab"
          />
        </template>
      </OptionsBar>
    </ToolbarRoot>
    <ViewChangesBar
      v-slot="{ hide }"
      :show="view.hasPersonal.value"
      :state="[options, draftFilter]"
    >
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
        @click="view.saveForAll"
      >
        {{ t('views.saved.saveForAll') }}
      </Button>
      <Button size="sm" :icon="RotateCcw" compact data-testid="node-reset" @click="view.reset">
        {{ t('views.saved.reset') }}
      </Button>
    </ViewChangesBar>
    <!-- «My day»: the planner on top, the view below (PLNRAPP-137); together they scroll, the view keeps a usable height -->
    <div :class="['min-h-0 flex-1', day && 'flex flex-col overflow-y-auto']">
      <MyDay v-if="day" class="shrink-0" :project-ids="scope.projectIds" />
      <div :class="day ? 'min-h-96 flex-1' : 'h-full'">
        <component
          :is="viewComponent"
          v-if="spaces && active"
          :key="`${key}:${active.key}`"
          :project-id="key"
          :scope="scope"
          :options="options"
          :filter="draftFilter"
          v-bind="active.ext ? { viewId: active.key } : {}"
        />
      </div>
    </div>
    <!-- в «Моей работе» окно задачи рисует экран группы -->
    <TaskModal v-if="!me" />
  </div>
</template>
