<script setup lang="ts">
import { computed, defineAsyncComponent, onScopeDispose, watch, type Component } from 'vue';
import {
  ChevronRight,
  FileText,
  FolderKanban,
  MessageSquare,
  Plus,
  Settings,
} from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { prefetchIdle, prefetchProject, useRootSpaceId, useWorkspace } from '../tasks/queries';
import { useExtensions } from '../modules/registry';
import type { LocalizedText } from '../modules/types';
import { sidebarCollapse as sc, useNavData, useUserMenu } from './nav';
import { useAuth } from '../auth/useAuth';
import { useSidebarActions } from './sidebarActions';
import { quickCreate } from '../command/hotkeys';
import { useRoute } from 'vue-router';
import { CheckSquare, FolderPlus, LayoutGrid } from 'lucide-vue-next';
import type { MenuItem } from '../ui/Menu.vue';
import NodeIcon from '../ui/NodeIcon.vue';

// reka (Avatar/Menu) — outside the initial bundle
const Avatar = defineAsyncComponent(() => import('../ui/Avatar.vue'));
const Menu = defineAsyncComponent(() => import('../ui/Menu.vue'));
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
const FAV_ICONS = {
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
        <template v-if="!sc.is('favorites')">
          <RouterLink
            v-for="f in favorites"
            :key="f.key"
            :to="f.to"
            :class="link"
            active-class="bg-accent-subtle"
            data-testid="nav-favorite"
          >
            <component :is="FAV_ICONS[f.kind]" :size="14" class="shrink-0 text-fg-muted" /><span
              class="truncate"
              >{{ f.name }}</span
            >
          </RouterLink>
        </template>
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
          <RouterLink to="/w" class="min-w-0 flex-1 truncate outline-none">{{
            t('sidebar.all')
          }}</RouterLink>
        </h2>
        <input
          v-if="act.editing.value === 'new-space'"
          :ref="focusInput"
          v-model="act.draft.value"
          :class="[input, 'mb-1']"
          :placeholder="t('sidebar.spaceName')"
          :aria-label="t('sidebar.spaceName')"
          @keydown="onKey"
          @blur="act.cancel"
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
                    :class="[link, 'pl-8 pr-1']"
                    active-class="bg-accent-subtle"
                    data-testid="nav-project"
                    @pointerenter="prefetchProject(p.id)"
                    @focus="prefetchProject(p.id)"
                  >
                    <span v-if="p.icon" :class="nodeIcon" aria-hidden="true"
                      ><NodeIcon :icon="p.icon"
                    /></span>
                    <span class="font-mono text-xs text-fg-muted">{{ p.prefix }}</span
                    ><span class="truncate" :style="p.color ? { color: p.color } : undefined">{{
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
                @keydown="onKey"
                @blur="act.cancel"
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
