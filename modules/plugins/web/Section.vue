<script setup lang="ts">
import { computed } from 'vue';
import { usePlugins } from './data.js';

const plugins = usePlugins();
const pages = computed(() => plugins.value.filter((p) => p.points.page));
</script>

<template>
  <nav v-if="pages.length" class="flex flex-col gap-1" data-testid="plugins-nav">
    <RouterLink
      v-for="p in pages"
      :key="p.id"
      :to="`/m/plugins/p/${p.id}`"
      class="rounded px-2 py-1 text-sm hover:bg-bg-hover"
    >
      {{ p.points.page!.label }}
    </RouterLink>
  </nav>
</template>
