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
import { Download, Inbox, PanelLeft, Plus, Search } from 'lucide-vue-next';
const BellMenu = defineAsyncComponent(() => import('../inbox/BellMenu.vue'));
import Button from '../ui/Button.vue';
import IconButton from '../ui/IconButton.vue';
import Kbd from '../ui/Kbd.vue';
import { useBreakpoint } from '../ui/useBreakpoint';
import { quickCreate, ui } from '../command/hotkeys';
import { useExtensions } from '../modules/registry';
import Breadcrumbs from './Breadcrumbs.vue';
import NodeIcon from '../ui/NodeIcon.vue';
import { groupUrl } from './groups';
import SyncStatus from './SyncStatus.vue';
import { useProject, useSpaces, useWorkspace } from '../tasks/queries';
import { mobileNav, useUserMenu } from './nav';

const { t } = useI18n();
const openNav = () => (mobileNav.value = true);
const route = useRoute();
const router = useRouter();
const { isMobile } = useBreakpoint();
const { notice } = useUserMenu();

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
// defineAsyncComponent once per element
const topbarComps = new Map<string, Component>();
const topbarComp = (key: string, load: () => Promise<{ default: Component }>) => {
  let c = topbarComps.get(key);
  if (!c) topbarComps.set(key, (c = defineAsyncComponent(load)));
  return c;
};

// on node screens (Workspace, space, project, saved view) the breadcrumbs are in the window header
const inProject = computed(() => route.name === 'project' || route.name === 'savedView');
const projectId = computed(() => String(route.params.projectId ?? ''));
const inGroup = computed(() =>
  ['workspace', 'space', 'project', 'savedView'].includes(String(route.name)),
);
// free space in the header on node screens — the node name (project, space, Workspace)
const project = useProject(() => (inProject.value ? projectId.value : ''));
const spaces = useSpaces();
const ws = useWorkspace();
const node = computed(() =>
  inProject.value
    ? project.value
    : route.name === 'space'
      ? spaces.value?.find((x) => x.id === route.params.spaceId)
      : ws.value,
);
const nodeUrl = computed(() =>
  inProject.value
    ? groupUrl('project', projectId.value)
    : route.name === 'space'
      ? groupUrl('space', String(route.params.spaceId))
      : groupUrl('workspace', ''),
);
</script>

<template>
  <!-- мобильная: кнопки 36px вместо 44px и без зазоров, иначе съедают крошки -->
  <header
    class="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-bg px-3 max-md:gap-0 max-md:px-1 max-md:[&_button.h-11]:h-9 max-md:[&_button.size-11]:size-9"
  >
    <IconButton v-if="isMobile" :icon="PanelLeft" :label="t('topbar.nav')" @click="openNav" />
    <Breadcrumbs v-if="!inGroup" class="max-md:px-1" />
    <span
      v-else
      class="flex min-w-0 flex-1 items-center gap-2 px-1 text-sm font-medium"
      data-testid="topbar-node"
    >
      <!-- нажатие — «Задачи» текущего уровня -->
      <RouterLink
        v-if="node"
        :to="nodeUrl"
        class="flex min-w-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 ring-focus"
        data-testid="topbar-node-link"
      >
        <span
          v-if="node.icon"
          class="flex size-6 shrink-0 items-center justify-center rounded-md text-base"
          aria-hidden="true"
          ><NodeIcon :icon="node.icon"
        /></span>
        <span class="truncate" :style="node.color ? { color: node.color } : undefined">{{
          node.name
        }}</span>
      </RouterLink>
    </span>
    <span v-if="notice" role="alert" class="text-sm text-fg-muted">{{ notice }}</span>
    <SyncStatus />
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
    <IconButton
      :icon="Plus"
      :label="t('topbar.newTask')"
      data-testid="topbar-create"
      @click="quickCreate(inProject ? projectId : '')"
    />
    <!-- «Моя работа» верхнего уровня: Воркспейс доступен всем участникам -->
    <IconButton
      :icon="Inbox"
      :label="t('groups.tab.work')"
      data-testid="topbar-work"
      @click="router.push('/w/work')"
    />
    <Button v-if="installEvent" size="sm" :icon="Download" @click="install">
      {{ t('topbar.install') }}
    </Button>
    <BellMenu />
  </header>
</template>
