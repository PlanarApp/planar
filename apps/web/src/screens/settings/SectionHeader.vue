<script setup lang="ts">
defineProps<{ title: string; description?: string }>();
</script>

<template>
  <header class="flex flex-wrap items-end justify-between gap-3">
    <div class="min-w-0">
      <h2 class="text-lg font-semibold">{{ title }}</h2>
      <p v-if="description" class="text-sm text-fg-muted">{{ description }}</p>
    </div>
    <slot />
  </header>
</template>
