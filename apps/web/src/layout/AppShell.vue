<script setup lang="ts">
import { watch } from 'vue';
import { useRoute } from 'vue-router';
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import { useI18n } from 'vue-i18n';
import { useBreakpoint } from '../ui/useBreakpoint';
import BottomNav from './BottomNav.vue';
import Sidebar from './Sidebar.vue';
import TopBar from './TopBar.vue';
import { mobileNav } from './nav';

const { isMobile } = useBreakpoint();
const { t } = useI18n();
const route = useRoute();
// переход по ссылке закрывает панель
watch(
  () => route.fullPath,
  () => (mobileNav.value = false),
);
</script>

<template>
  <div class="flex h-full bg-bg text-fg">
    <Sidebar v-if="!isMobile" />
    <DialogRoot v-if="isMobile" v-model:open="mobileNav">
      <DialogPortal>
        <DialogOverlay class="fixed inset-0 z-40 bg-overlay" />
        <DialogContent
          aria-describedby="undefined"
          class="fixed inset-y-0 left-0 z-50 flex w-70 max-w-full outline-none [&>aside]:w-full"
        >
          <DialogTitle class="sr-only">{{ t('topbar.nav') }}</DialogTitle>
          <Sidebar />
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
    <div class="flex min-w-0 flex-1 flex-col">
      <TopBar />
      <main class="min-h-0 flex-1 overflow-auto"><RouterView /></main>
      <BottomNav v-if="isMobile" />
    </div>
  </div>
</template>
