<script setup lang="ts">
import type { Row } from '@planar/shared';

defineProps<{ status: Row<'statuses'> }>();
</script>

<template>
  <svg
    width="14"
    height="14"
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    aria-hidden="true"
    :style="{ color: status.color }"
    :data-category="status.category"
  >
    <circle
      cx="7"
      cy="7"
      r="5.5"
      :stroke-dasharray="status.category === 'backlog' ? '2 2' : undefined"
    />
    <path
      v-if="status.category === 'in_progress'"
      d="M7 3.5a3.5 3.5 0 0 1 0 7z"
      fill="currentColor"
    />
    <path v-if="status.category === 'done'" d="M4.5 7.2 6.3 9l3.2-3.6" stroke-linecap="round" />
    <path v-if="status.category === 'cancelled'" d="M5 5l4 4M9 5l-4 4" stroke-linecap="round" />
  </svg>
</template>
