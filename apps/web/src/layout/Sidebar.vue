<script setup lang="ts">
import { computed, defineAsyncComponent, onScopeDispose, watch, type Component } from 'vue';
import {
  ChevronRight,
  FileText,
  FolderKanban,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  X,
} from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { prefetchIdle, prefetchProject, useRootSpaceId, useWorkspace } from '../tasks/queries';
import { useExtensions } from '../modules/registry';
import type { LocalizedText } from '../modules/types';
import { VueDraggable } from 'vue-draggable-plus';
import { favorites as favStore, sidebarCollapse as sc, useNavData, useUserMenu } from './nav';
import { useAuth } from '../auth/useAuth';
import { useSidebarActions } from './sidebarActions';
import { quickCreate } from '../command/hotkeys';
import { useRoute } from 'vue-router';
import { CheckSquare, FolderPlus, LayoutGrid } from 'lucide-vue-next';
import type { MenuItem } from '../ui/Menu.vue';
import NodeIcon from '../ui/NodeIcon.vue';
import { useBreakpoint } from '../ui/useBreakpoint';
import { setSidebarMode, sidebarMode } from './sidebarWidth';
import { dragged, endTaskDrag, overProject } from '../tasks/dropToProject';

// reka (Avatar/Menu) — outside the initial bundle
const Avatar = defineAsyncComponent(() => import('../ui/Avatar.vue'));
const Menu = defineAsyncComponent(() => import('../ui/Menu.vue'));
const { isMobile } = useBreakpoint();
const rail = computed(() => !isMobile.value && sidebarMode.value === 'rail');
const { user } = useAuth();
const { items } = useUserMenu();

const { t, te, locale } = useI18n();
const navItems = useExtensions('nav');
// a section is its own component; a loading error does not break the panel
const sections = new Map<string, Component>();
const section = (key: string, load: () => Promise<{ default: Component }>) => {
  let c = sections.get(key);
  if (!c)
    sections.set(key, (c = defineAsyncComponent({ loader: load, errorComponent: () => null })));
  return c;
};
const navLabel = (l: LocalizedText) =>
  typeof l === 'object' ? l[locale.value as 'ru' | 'en'] : te(l) ? t(l) : l;
const { spaces: allSpaces, favorites } = useNavData();
// favourites are dragged to change their order (PLNRAPP-72)
function moveFav(e: { oldIndex?: number; newIndex?: number }) {
  const keys = favorites.value.map((f) => f.key);
  const [k] = keys.splice(e.oldIndex!, 1);
  keys.splice(e.newIndex!, 0, k!);
  favStore.reorder(keys);
}
// a task card dragged from the board onto a project moves there (PLNRAPP-152); other drags are ignored
function dragOver(projectId: string, e: DragEvent) {
  if (!dragged.value) return;
  e.preventDefault();
  overProject.value = projectId;
}
const dragLeave = (projectId: string) => {
  if (overProject.value === projectId) overProject.value = null;
};
function dropTask(projectId: string, e: DragEvent) {
  if (!dragged.value) return;
  e.preventDefault();
  endTaskDrag(projectId);
}
const FAV_ICONS = {
  workspace: LayoutGrid,
  space: LayoutGrid,
  project: FolderKanban,
  doc: FileText,
  chat: MessageSquare,
  task: CheckSquare,
};
// group tree: Workspace (root space) › spaces › projects
const rootId = useRootSpaceId();
const ws = useWorkspace();
const spaces = computed(() => allSpaces.value.filter((s) => s.id !== rootId.value));
const act = useSidebarActions();
// inline input field: Enter — save, Esc/blur with no text — cancel
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Enter') void act.commit();
  else if (e.key === 'Escape') act.cancel();
};
const focusInput = (el: unknown) => (el as HTMLInputElement | null)?.focus();
const route = useRoute();
const createItems = (): MenuItem[] => {
  const pid =
    route.name === 'project' || route.name === 'savedView' ? String(route.params.projectId) : '';
  const space = spaces.value.find((s) => s.projects.some((p) => p.id === pid)) ?? spaces.value[0];
  return [
    {
      id: 'task',
      label: t('sidebar.newTask'),
      icon: CheckSquare,
      shortcut: 'c',
      onSelect: () => quickCreate(pid),
    },
    ...(space
      ? [
          {
            id: 'project',
            label: t('sidebar.newProject'),
            icon: FolderPlus,
            onSelect: () => {
              if (sc.is('spaces')) sc.toggle('spaces');
              if (sc.is('space:' + space.id)) sc.toggle('space:' + space.id);
              act.start('new:' + space.id);
            },
          },
        ]
      : []),
    {
      id: 'space',
      label: t('sidebar.newSpace'),
      icon: LayoutGrid,
      onSelect: () => {
        if (sc.is('spaces')) sc.toggle('spaces');
        act.start('new-space');
      },
    },
  ];
};
// projects are built in memory in advance: on hover/focus of the link and once when idle after the list appears
let idle: ReturnType<typeof setTimeout> | undefined;
const stop = watch(
  () => spaces.value.length > 0,
  (has) => {
    if (!has) return;
    stop();
    idle = setTimeout(
      () => prefetchIdle(spaces.value.flatMap((s) => s.projects.map((p) => p.id))),
      500,
    );
  },
  { immediate: true },
);
onScopeDispose(() => clearTimeout(idle));
const link =
  'flex h-7 items-center gap-2 rounded-md px-2 text-sm text-fg hover:bg-bg-muted outline-none focus-visible:ring-2 ring-focus';
const head =
  'flex h-7 w-full items-center gap-1 rounded-md px-2 text-xs font-medium uppercase text-fg-muted hover:bg-bg-muted outline-none focus-visible:ring-2 ring-focus';
const chev = (id: string) => ['shrink-0 transition-transform', !sc.is(id) && 'rotate-90'];
const input = 'h-7 w-full rounded-md border border-accent bg-bg px-2 text-sm text-fg outline-none';
// node icon in the tree: emoji or image, next to the name
const nodeIcon = 'flex size-4 shrink-0 items-center justify-center text-sm';
</script>

<template>
  <aside
    v-if="rail"
    data-testid="sidebar-rail"
    class="sidebar-dark flex shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-sidebar-bg py-2 text-fg"
  >
    <button
      type="button"
      :aria-label="t('sidebar.expandBar')"
      data-testid="sidebar-expand"
      :class="[link, 'size-8 justify-center px-0']"
      @click="setSidebarMode('full')"
    >
      <PanelLeftOpen :size="16" />
    </button>
    <button
      type="button"
      :aria-label="t('sidebar.hide')"
      data-testid="sidebar-hide"
      :class="[link, 'size-8 justify-center px-0']"
      @click="setSidebarMode('hidden')"
    >
      <X :size="16" />
    </button>
    <!-- избранное — над проектами, через черту (PLNRAPP-87) -->
    <template v-if="favorites.length">
      <VueDraggable
        :model-value="favorites"
        :animation="150"
        class="flex flex-col items-center gap-1"
        data-testid="nav-favorites-rail"
        @update="moveFav"
      >
        <RouterLink
          v-for="f in favorites"
          :key="f.key"
          :to="f.to"
          :title="f.name"
          :aria-label="f.name"
          class="flex h-8 w-10 items-center justify-center rounded-md outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus"
          active-class="bg-accent-subtle"
          data-testid="nav-favorite-rail"
          :style="f.color ? { color: f.color } : undefined"
        >
          <span v-if="f.icon" :class="nodeIcon" aria-hidden="true"
            ><NodeIcon :icon="f.icon"
          /></span>
          <component :is="FAV_ICONS[f.kind]" v-else :size="16" aria-hidden="true" />
        </RouterLink>
      </VueDraggable>
      <hr class="my-1 w-6 border-border" />
    </template>
    <template v-for="s in spaces" :key="s.id">
      <RouterLink
        v-for="p in s.projects"
        :key="p.id"
        :to="`/p/${p.id}`"
        :title="p.name"
        :aria-label="p.name"
        class="flex h-8 w-10 items-center justify-center truncate rounded-md text-xs font-medium outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus"
        active-class="bg-accent-subtle"
        data-testid="nav-project-rail"
        :style="p.color ? { color: p.color } : undefined"
        @pointerenter="prefetchProject(p.id)"
      >
        <span v-if="p.icon" :class="nodeIcon" aria-hidden="true"><NodeIcon :icon="p.icon" /></span>
        <template v-else>{{ p.prefix.slice(0, 2) }}</template>
      </RouterLink>
    </template>
    <RouterLink
      to="/w/settings"
      :aria-label="t('sidebar.settings')"
      :title="t('sidebar.settings')"
      :class="[link, 'mt-auto size-8 justify-center px-0']"
      active-class="bg-accent-subtle"
    >
      <Settings :size="16" />
    </RouterLink>
  </aside>
  <aside
    v-else
    data-testid="sidebar"
    class="sidebar-dark flex w-60 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-sidebar-bg p-2 text-fg"
  >
    <div class="flex h-9 items-center gap-2 px-1">
      <!-- как в шапке: значок без подложки, название цветом узла -->
      <span
        v-if="ws.icon"
        class="flex size-6 shrink-0 items-center justify-center rounded-md text-base"
        aria-hidden="true"
        ><NodeIcon :icon="ws.icon"
      /></span>
      <span
        class="flex-1 truncate text-base font-semibold"
        :style="ws.color ? { color: ws.color } : undefined"
        >{{ ws.name }}</span
      >
      <button
        v-if="!isMobile"
        type="button"
        :aria-label="t('sidebar.collapse')"
        data-testid="sidebar-collapse"
        class="flex size-7 shrink-0 items-center justify-center rounded-md outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus"
        @click="setSidebarMode('rail')"
      >
        <PanelLeftClose :size="16" />
      </button>
      <Menu :items="items()" align="end">
        <template #trigger>
          <button
            type="button"
            :aria-label="t('topbar.menu')"
            class="flex size-7 items-center justify-center rounded-full outline-none focus-visible:ring-2 ring-focus"
          >
            <Avatar
              :name="user?.name ?? 'Planar'"
              :src="user?.avatarFile ? `/files/${user.avatarFile}/preview?w=256` : null"
              size="md"
            />
          </button>
        </template>
      </Menu>
    </div>
    <Menu :items="createItems()" align="start">
      <template #trigger>
        <button
          type="button"
          class="flex h-8 items-center gap-2 rounded-md border border-border px-2 text-sm text-fg hover:bg-bg-muted outline-none focus-visible:ring-2 ring-focus"
          data-testid="create-menu"
        >
          <Plus :size="16" />{{ t('sidebar.create') }}
        </button>
      </template>
    </Menu>
    <nav class="flex flex-col gap-3">
      <!-- отделено от дерева чертой -->
      <section v-if="favorites.length" class="border-b border-border pb-3">
        <h2>
          <button
            type="button"
            :class="head"
            :aria-expanded="!sc.is('favorites')"
            @click="sc.toggle('favorites')"
          >
            <ChevronRight :size="12" :class="chev('favorites')" />{{ t('sidebar.favorites') }}
          </button>
        </h2>
        <VueDraggable
          v-if="!sc.is('favorites')"
          :model-value="favorites"
          :animation="150"
          class="flex flex-col"
          data-testid="nav-favorites"
          @update="moveFav"
        >
          <RouterLink
            v-for="f in favorites"
            :key="f.key"
            :to="f.to"
            :class="link"
            active-class="bg-accent-subtle"
            data-testid="nav-favorite"
          >
            <span v-if="f.icon" :class="nodeIcon" aria-hidden="true"
              ><NodeIcon :icon="f.icon"
            /></span>
            <component
              :is="FAV_ICONS[f.kind]"
              v-else
              :size="14"
              class="shrink-0 text-fg-muted"
            /><span class="truncate" :style="f.color ? { color: f.color } : undefined">{{
              f.name
            }}</span>
          </RouterLink>
        </VueDraggable>
      </section>
      <!-- корневой узел дерева: «Всё», отделён от списка пространств чертой -->
      <section class="border-b border-border pb-2">
        <h2 :class="[link, 'w-full pr-1 font-semibold']" data-testid="nav-workspace">
          <button
            type="button"
            class="flex shrink-0 items-center outline-none"
            :aria-label="t('sidebar.expand')"
            :aria-expanded="!sc.is('spaces')"
            @click="sc.toggle('spaces')"
          >
            <ChevronRight :size="12" :class="chev('spaces')" />
          </button>
          <span v-if="ws.icon" :class="nodeIcon" aria-hidden="true"
            ><NodeIcon :icon="ws.icon"
          /></span>
          <RouterLink
            to="/w"
            class="min-w-0 flex-1 truncate outline-none"
            :style="ws.color ? { color: ws.color } : undefined"
            >{{ t('sidebar.all') }}</RouterLink
          >
        </h2>
        <input
          v-if="act.editing.value === 'new-space'"
          :ref="focusInput"
          v-model="act.draft.value"
          :class="[input, 'mb-1']"
          :placeholder="t('sidebar.spaceName')"
          :aria-label="t('sidebar.spaceName')"
          data-inline-edit
          @keydown="onKey"
          @blur="act.blurNew"
        />
      </section>
      <section>
        <template v-if="!sc.is('spaces')">
          <div v-for="s in spaces" :key="s.id">
            <input
              v-if="act.editing.value === 'space:' + s.id"
              :ref="focusInput"
              v-model="act.draft.value"
              :class="input"
              :aria-label="t('sidebar.rename')"
              @keydown="onKey"
              @blur="act.commit"
            />
            <Menu v-else context :items="act.spaceItems(s)">
              <div :class="[link, 'w-full pr-1 font-medium']" data-testid="nav-space">
                <button
                  type="button"
                  class="flex shrink-0 items-center outline-none"
                  :aria-label="t('sidebar.expand')"
                  :aria-expanded="!sc.is('space:' + s.id)"
                  @click="sc.toggle('space:' + s.id)"
                >
                  <ChevronRight :size="12" :class="chev('space:' + s.id)" />
                </button>
                <span v-if="s.icon" :class="nodeIcon" aria-hidden="true"
                  ><NodeIcon :icon="s.icon"
                /></span>
                <RouterLink
                  :to="`/s/${s.id}`"
                  class="min-w-0 flex-1 truncate outline-none"
                  :style="s.color ? { color: s.color } : undefined"
                  >{{ s.name }}</RouterLink
                >
              </div>
            </Menu>
            <template v-if="!sc.is('space:' + s.id) || act.editing.value === 'new:' + s.id">
              <template v-for="p in s.projects" :key="p.id">
                <input
                  v-if="act.editing.value === p.id"
                  :ref="focusInput"
                  v-model="act.draft.value"
                  :class="[input, 'ml-5 w-[calc(100%-1.25rem)]']"
                  :aria-label="t('sidebar.rename')"
                  @keydown="onKey"
                  @blur="act.commit"
                />
                <Menu v-else context :items="act.projectItems(p)">
                  <RouterLink
                    :to="`/p/${p.id}`"
                    :class="[link, 'pl-8 pr-1', overProject === p.id && 'ring-2 ring-focus']"
                    active-class="bg-accent-subtle"
                    data-testid="nav-project"
                    :data-drop-project="p.id"
                    @pointerenter="prefetchProject(p.id)"
                    @focus="prefetchProject(p.id)"
                    @dragover="dragOver(p.id, $event)"
                    @dragleave="dragLeave(p.id)"
                    @drop="dropTask(p.id, $event)"
                  >
                    <span v-if="p.icon" :class="nodeIcon" aria-hidden="true"
                      ><NodeIcon :icon="p.icon"
                    /></span>
                    <span class="truncate" :style="p.color ? { color: p.color } : undefined">{{
                      p.name
                    }}</span>
                  </RouterLink>
                </Menu>
              </template>
              <input
                v-if="act.editing.value === 'new:' + s.id"
                :ref="focusInput"
                v-model="act.draft.value"
                :class="[input, 'ml-5 w-[calc(100%-1.25rem)]']"
                :placeholder="t('sidebar.projectName')"
                :aria-label="t('sidebar.projectName')"
                data-inline-edit
                @keydown="onKey"
                @blur="act.blurNew"
              />
            </template>
          </div>
          <p v-if="!spaces.length" class="px-2 text-sm text-fg-muted">{{ t('sidebar.empty') }}</p>
        </template>
      </section>
      <!-- пункты модулей (страницы плагинов) — без своего заголовка -->
      <div v-if="navItems.length" class="flex flex-col gap-0.5">
        <template v-for="n in navItems" :key="n.key">
          <component
            :is="section(n.key, n.section)"
            v-if="'section' in n"
            data-testid="nav-section"
          />
          <RouterLink v-else :to="n.to" :class="link" active-class="bg-accent-subtle">
            <component :is="n.icon" :size="16" />{{ navLabel(n.label) }}
          </RouterLink>
        </template>
      </div>
    </nav>
    <RouterLink to="/w/settings" :class="[link, 'mt-auto']" active-class="bg-accent-subtle">
      <Settings :size="16" />{{ t('sidebar.settings') }}
    </RouterLink>
  </aside>
</template>

<style>
/* dark panel: semantic tokens inside <aside> are replaced by sidebar tokens */
.sidebar-dark {
  --color-bg: var(--color-sidebar-bg);
  --color-fg: var(--color-sidebar-fg);
  --color-fg-muted: var(--color-sidebar-fg-muted);
  --color-fg-subtle: var(--color-sidebar-fg-muted);
  --color-bg-muted: var(--color-sidebar-hover);
  --color-accent-subtle: var(--color-sidebar-active);
  --color-border: var(--color-sidebar-border);
}
</style>
