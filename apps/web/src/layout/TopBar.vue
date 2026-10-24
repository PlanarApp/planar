<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  type Component,
} from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Bell, ChevronRight, Download, PanelLeft, Search } from 'lucide-vue-next';
// reka (Avatar/Menu) — вне начального бандла
const Avatar = defineAsyncComponent(() => import('../ui/Avatar.vue'));
const Menu = defineAsyncComponent(() => import('../ui/Menu.vue'));
import Button from '../ui/Button.vue';
import IconButton from '../ui/IconButton.vue';
import Kbd from '../ui/Kbd.vue';
import { useBreakpoint } from '../ui/useBreakpoint';
import { ui } from '../command/hotkeys';
import { useAuth } from '../auth/useAuth';
import { useUnread } from '../inbox/queries';
import { useExtensions } from '../modules/registry';
import { useProject, useSpaces } from '../tasks/queries';
import { useSavedView } from '../views/saved/queries';
import { mobileNav, useUserMenu } from './nav';

const { t, te, locale } = useI18n();
const openNav = () => (mobileNav.value = true);
const route = useRoute();
const router = useRouter();
const { user } = useAuth();
const { isMobile } = useBreakpoint();
const { items, notice } = useUserMenu();
const unread = useUnread();

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
}
const installEvent = ref<InstallEvent | null>(null);
const onPrompt = (e: Event) => {
  e.preventDefault();
  installEvent.value = e as InstallEvent;
};
onMounted(() => window.addEventListener('beforeinstallprompt', onPrompt));
onBeforeUnmount(() => window.removeEventListener('beforeinstallprompt', onPrompt));
const install = async () => {
  await installEvent.value?.prompt();
  installEvent.value = null;
};

const topbarItems = useExtensions('topbar');
// defineAsyncComponent на каждый элемент один раз
const topbarComps = new Map<string, Component>();
const topbarComp = (key: string, load: () => Promise<{ default: Component }>) => {
  let c = topbarComps.get(key);
  if (!c) topbarComps.set(key, (c = defineAsyncComponent(load)));
  return c;
};

// хлебные крошки: пространство / проект / вид; на прочих экранах — название экрана
const projectId = computed(() => String(route.params.projectId ?? ''));
const inProject = computed(() => route.name === 'project' || route.name === 'savedView');
const project = useProject(() => (inProject.value ? projectId.value : ''));
const spaces = useSpaces();
const saved = useSavedView(() => (route.name === 'savedView' ? String(route.params.viewId) : ''));
const extViews = useExtensions('views');
const text = (l: string | { ru: string; en: string }) =>
  typeof l === 'object' ? l[locale.value as 'ru' | 'en'] : te(l) ? t(l) : l;
const viewLabel = computed(() => {
  if (route.name === 'savedView') return saved.value?.name ?? '';
  const v = String(route.params.view || 'list');
  const ext = extViews.value.find((e) => e.key === v);
  return ext ? text(ext.label) : te(`views.${v}`) ? t(`views.${v}`) : v;
});
const crumbs = computed(() => {
  if (!inProject.value) {
    return [route.name ? t(`screens.${String(route.name)}`) : t('app.name')];
  }
  const p = project.value;
  const space = spaces.value?.find((s) => s.id === p?.spaceId)?.name;
  return [space, p?.name, viewLabel.value].filter((x): x is string => !!x);
});
</script>

<template>
  <header class="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-bg px-3">
    <IconButton v-if="isMobile" :icon="PanelLeft" :label="t('topbar.nav')" @click="openNav" />
    <nav :aria-label="t('topbar.breadcrumb')" class="min-w-0 flex-1">
      <h1 class="flex items-center gap-1 truncate text-sm">
        <template v-for="(c, i) in crumbs" :key="i">
          <ChevronRight v-if="i" :size="12" class="shrink-0 text-fg-subtle" aria-hidden="true" />
          <span :class="['truncate', i === crumbs.length - 1 ? 'font-medium' : 'text-fg-muted']">{{
            c
          }}</span>
        </template>
      </h1>
    </nav>
    <span v-if="notice" role="alert" class="text-sm text-fg-muted">{{ notice }}</span>
    <component
      :is="topbarComp(i.key, i.component)"
      v-for="i in topbarItems"
      :key="i.key"
      data-testid="topbar-item"
    />
    <IconButton v-if="isMobile" :icon="Search" :label="t('cmd.open')" @click="ui.palette = true" />
    <Button v-else size="sm" :icon="Search" :aria-label="t('cmd.open')" @click="ui.palette = true">
      {{ t('topbar.search') }}<Kbd keys="Mod+K" />
    </Button>
    <Button v-if="installEvent" size="sm" :icon="Download" @click="install">
      {{ t('topbar.install') }}
    </Button>
    <span class="relative">
      <IconButton :icon="Bell" :label="t('topbar.notifications')" @click="router.push('/inbox')" />
      <span
        v-if="unread"
        data-testid="bell-count"
        class="pointer-events-none absolute right-0 top-0 min-w-4 rounded-full bg-accent px-1 text-center text-2xs text-accent-fg"
        >{{ unread }}</span
      >
    </span>
    <Menu v-if="isMobile" :items="items()" align="end">
      <template #trigger>
        <button
          type="button"
          :aria-label="t('topbar.menu')"
          class="flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 ring-focus"
        >
          <Avatar
            :name="user?.name ?? 'Planar'"
            :src="user?.avatarFile ? `/files/${user.avatarFile}/preview?w=256` : null"
            size="md"
          />
        </button>
      </template>
    </Menu>
  </header>
</template>
