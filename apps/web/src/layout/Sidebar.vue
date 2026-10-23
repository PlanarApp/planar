<script setup lang="ts">
import { defineAsyncComponent, onScopeDispose, watch, type Component } from 'vue';
import { Inbox, ListChecks, Settings, Star } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import Badge from '../ui/Badge.vue';
import { useUnread } from '../inbox/queries';
import { prefetchIdle, prefetchProject } from '../tasks/queries';
import { useExtensions } from '../modules/registry';
import type { LocalizedText } from '../modules/types';
import { useNavData } from './nav';

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
  'flex h-8 items-center gap-2 rounded-md px-2 text-base text-fg hover:bg-bg-muted outline-none focus-visible:ring-2 ring-focus';
</script>

<template>
  <aside
    data-testid="sidebar"
    class="flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-bg-subtle p-2"
  >
    <nav class="flex flex-col gap-0.5">
      <RouterLink to="/inbox" :class="link" active-class="bg-accent-subtle">
        <Inbox :size="16" />{{ t('sidebar.inbox') }}
        <Badge v-if="unread" variant="solid" class="ml-auto">{{ unread }}</Badge>
      </RouterLink>
      <RouterLink to="/my" :class="link" active-class="bg-accent-subtle">
        <ListChecks :size="16" />{{ t('sidebar.my') }}
      </RouterLink>
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
    </nav>
    <section>
      <h2 class="mb-1 flex items-center gap-1 px-2 text-xs font-medium text-fg-muted">
        <Star :size="12" />{{ t('sidebar.favorites') }}
      </h2>
      <RouterLink v-for="f in favorites" :key="f.id" :to="f.to" :class="link">
        {{ f.name }}
      </RouterLink>
      <p v-if="!favorites.length" class="px-2 text-sm text-fg-subtle">{{ t('sidebar.empty') }}</p>
    </section>
    <section class="flex-1">
      <h2 class="mb-1 px-2 text-xs font-medium text-fg-muted">{{ t('sidebar.spaces') }}</h2>
      <div v-for="s in spaces" :key="s.id" class="mb-2">
        <div class="px-2 text-sm font-medium text-fg">{{ s.name }}</div>
        <RouterLink
          v-for="p in s.projects"
          :key="p.id"
          :to="`/p/${p.id}`"
          :class="link"
          @pointerenter="prefetchProject(p.id)"
          @focus="prefetchProject(p.id)"
        >
          <span class="text-xs text-fg-subtle">{{ p.prefix }}</span
          >{{ p.name }}
        </RouterLink>
      </div>
      <p v-if="!spaces.length" class="px-2 text-sm text-fg-subtle">{{ t('sidebar.empty') }}</p>
    </section>
    <RouterLink to="/settings" :class="link" active-class="bg-accent-subtle">
      <Settings :size="16" />{{ t('sidebar.settings') }}
    </RouterLink>
  </aside>
</template>
