<script setup lang="ts">
import type { Component } from 'vue';

defineProps<{ title: string; description?: string; icon?: Component }>();
</script>

<template>
  <div class="flex flex-col items-center gap-2 px-4 pt-12 pb-8 text-center">
    <component :is="icon" v-if="icon" :size="32" class="text-fg-subtle" />
    <p class="text-base font-medium text-fg">{{ title }}</p>
    <p v-if="description" class="max-w-[360px] text-sm text-fg-muted">{{ description }}</p>
    <div v-if="$slots.actions" class="mt-2 flex gap-2"><slot name="actions" /></div>
  </div>
</template>
