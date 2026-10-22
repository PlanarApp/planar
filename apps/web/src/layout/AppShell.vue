<script setup lang="ts">
import { useBreakpoint } from '../ui';
import BottomNav from './BottomNav.vue';
import Sidebar from './Sidebar.vue';
import TopBar from './TopBar.vue';

const { isMobile } = useBreakpoint();
</script>

<template>
  <div class="flex h-full bg-bg text-fg">
    <Sidebar v-if="!isMobile" />
    <div class="flex min-w-0 flex-1 flex-col">
      <TopBar />
      <main class="min-h-0 flex-1 overflow-auto"><RouterView /></main>
      <BottomNav v-if="isMobile" />
    </div>
  </div>
</template>
