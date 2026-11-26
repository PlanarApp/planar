<script setup lang="ts">
import type { Component } from 'vue';
import NodeIcon from './NodeIcon.vue';

// a space / project icon in a menu: its own (emoji or image) or the fallback icon, in the node's color
defineProps<{ icon?: string | null; fallback: Component; color?: string | null; size?: number }>();
</script>

<template>
  <span
    class="flex size-4 shrink-0 items-center justify-center text-sm"
    :style="color ? { color } : undefined"
    aria-hidden="true"
  >
    <NodeIcon v-if="icon" :icon="icon" />
    <component :is="fallback" v-else :size="size ?? 16" />
  </span>
</template>
