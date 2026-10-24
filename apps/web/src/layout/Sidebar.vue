<script setup lang="ts">
import { defineAsyncComponent, onScopeDispose, provide, watch, type Component } from 'vue';
import { ChevronRight, Inbox, ListChecks, Settings } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import { useUnread } from '../inbox/queries';
import { prefetchIdle, prefetchProject } from '../tasks/queries';
import { useExtensions } from '../modules/registry';
import type { LocalizedText } from '../modules/types';
import { sidebarCollapse as sc, useNavData, useUserMenu } from './nav';
import { useAuth } from '../auth/useAuth';

// reka (Avatar/Menu) — вне начального бандла
const Avatar = defineAsyncComponent(() => import('../ui/Avatar.vue'));
const Menu = defineAsyncComponent(() => import('../ui/Menu.vue'));
const { user } = useAuth();
const { items } = useUserMenu();
// секции модулей сворачиваются тем же хранилищем
provide('planar.sidebar.collapse', sc);

const { t, te, locale } = useI18n();
const navItems = useExtensions('nav');
// секция — свой компонент; ошибка загрузки не ломает панель
const sections = new Map<string, Component>();
const section = (key: string, load: () => Promise<{ default: Component }>) => {
  let c = sections.get(key);
  if (!c)
    sections.set(key, (c = defineAsyncComponent({ loader: load, errorComponent: () => null })));
  return c;
};
const navLabel = (l: LocalizedText) =>
  typeof l === 'object' ? l[locale.value as 'ru' | 'en'] : te(l) ? t(l) : l;
const unread = useUnread();
const { spaces, favorites } = useNavData();
// проекты строятся в памяти заранее: по наведению/фокусу на ссылку и один раз в простое после появления списка
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
</script>

<template>
  <aside
    data-testid="sidebar"
    class="sidebar-dark flex w-60 shrink-0 flex-col gap-3 overflow-y-auto border-r border-border bg-sidebar-bg p-2 text-fg"
  >
    <div class="flex h-9 items-center gap-2 px-1">
      <span
        class="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-xs font-semibold text-accent-fg"
        aria-hidden="true"
        >P</span
      >
      <span class="flex-1 truncate text-base font-semibold">{{ t('app.name') }}</span>
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
    <nav class="flex flex-col gap-3">
      <div class="flex flex-col gap-0.5">
        <RouterLink to="/inbox" :class="link" active-class="bg-accent-subtle">
          <Inbox :size="16" />{{ t('sidebar.inbox') }}
          <span
            v-if="unread"
            class="ml-auto rounded-full bg-accent px-1.5 text-xs text-accent-fg"
            >{{ unread }}</span
          >
        </RouterLink>
        <RouterLink to="/my" :class="link" active-class="bg-accent-subtle">
          <ListChecks :size="16" />{{ t('sidebar.my') }}
        </RouterLink>
      </div>
      <section v-if="favorites.length">
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
          <RouterLink v-for="f in favorites" :key="f.id" :to="f.to" :class="link">
            {{ f.name }}
          </RouterLink>
        </template>
      </section>
      <section>
        <h2>
          <button
            type="button"
            :class="head"
            :aria-expanded="!sc.is('spaces')"
            @click="sc.toggle('spaces')"
          >
            <ChevronRight :size="12" :class="chev('spaces')" />{{ t('sidebar.spaces') }}
          </button>
        </h2>
        <template v-if="!sc.is('spaces')">
          <div v-for="s in spaces" :key="s.id">
            <button
              type="button"
              :class="[link, 'w-full font-medium']"
              :aria-expanded="!sc.is('space:' + s.id)"
              @click="sc.toggle('space:' + s.id)"
            >
              <ChevronRight :size="12" :class="chev('space:' + s.id)" />
              <span class="truncate">{{ s.name }}</span>
            </button>
            <template v-if="!sc.is('space:' + s.id)">
              <RouterLink
                v-for="p in s.projects"
                :key="p.id"
                :to="`/p/${p.id}`"
                :class="[link, 'pl-7']"
                active-class="bg-accent-subtle"
                @pointerenter="prefetchProject(p.id)"
                @focus="prefetchProject(p.id)"
              >
                <span class="font-mono text-xs text-fg-muted">{{ p.prefix }}</span
                ><span class="truncate">{{ p.name }}</span>
              </RouterLink>
            </template>
          </div>
          <p v-if="!spaces.length" class="px-2 text-sm text-fg-muted">{{ t('sidebar.empty') }}</p>
        </template>
      </section>
      <section v-if="navItems.length">
        <h2>
          <button
            type="button"
            :class="head"
            :aria-expanded="!sc.is('sections')"
            @click="sc.toggle('sections')"
          >
            <ChevronRight :size="12" :class="chev('sections')" />{{ t('sidebar.sections') }}
          </button>
        </h2>
        <div v-show="!sc.is('sections')" class="flex flex-col gap-0.5">
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
      </section>
    </nav>
    <RouterLink to="/settings" :class="[link, 'mt-auto']" active-class="bg-accent-subtle">
      <Settings :size="16" />{{ t('sidebar.settings') }}
    </RouterLink>
  </aside>
</template>

<style>
/* тёмная панель: семантические токены внутри <aside> заменены sidebar-токенами */
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
