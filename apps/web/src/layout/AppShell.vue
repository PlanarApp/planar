<script setup lang="ts">
import { watch } from 'vue';
import { useRoute } from 'vue-router';
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { useI18n } from 'vue-i18n';
import { useBreakpoint } from '../ui/useBreakpoint';
import Sidebar from './Sidebar.vue';
import TopBar from './TopBar.vue';
import { mobileNav } from './nav';
import {
  RAIL_WIDTH,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  setSidebarWidth,
  sidebarMode,
  sidebarWidth,
} from './sidebarWidth';

const { isMobile } = useBreakpoint();
const { t } = useI18n();
const route = useRoute();
// following a link closes the panel; a click on a link to the current route doesn't change route — we catch the click
const closeOnLink = (e: MouseEvent) => {
  if ((e.target as Element).closest('a[href]')) mobileNav.value = false;
};
// drag the divider: window listeners until the button is released
const onDown = () => {
  const move = (e: PointerEvent) => setSidebarWidth(e.clientX);
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
};
const onKey = (e: KeyboardEvent) => {
  const d = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
  if (d) setSidebarWidth(sidebarWidth.value + d);
};
watch(
  () => route.fullPath,
  () => (mobileNav.value = false),
);
</script>

<template>
  <div class="flex h-full bg-bg text-fg">
    <div
      v-if="!isMobile && sidebarMode !== 'hidden'"
      class="relative flex shrink-0 [&>aside]:w-full"
      :style="{ width: (sidebarMode === 'rail' ? RAIL_WIDTH : sidebarWidth) + 'px' }"
    >
      <Sidebar />
      <div
        v-if="sidebarMode === 'full'"
        role="separator"
        aria-orientation="vertical"
        tabindex="0"
        data-testid="sidebar-resize"
        :aria-valuenow="sidebarWidth"
        :aria-valuemin="SIDEBAR_MIN"
        :aria-valuemax="SIDEBAR_MAX"
        class="absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none outline-none hover:bg-accent/40 focus-visible:bg-accent/60"
        @pointerdown.prevent="onDown"
        @keydown="onKey"
      />
    </div>
    <DialogRoot v-if="isMobile" v-model:open="mobileNav">
      <DialogPortal>
        <DialogOverlay class="fixed inset-0 z-40 bg-overlay" />
        <DialogContent
          aria-describedby="undefined"
          class="fixed inset-y-0 left-0 z-50 flex w-70 max-w-full outline-none [&>aside]:w-full"
          @click="closeOnLink"
        >
          <DialogTitle class="sr-only">{{ t('topbar.nav') }}</DialogTitle>
          <Sidebar />
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
    <div class="flex min-w-0 flex-1 flex-col">
      <TopBar />
      <main class="min-h-0 flex-1 overflow-auto"><RouterView /></main>
    </div>
  </div>
</template>
