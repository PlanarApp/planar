<script setup lang="ts">
import { computed } from 'vue';

// своя разметка: у lucide Signal* столбики занимают ~половину рамки и в 16 px читаются как точки
const props = withDefaults(defineProps<{ priority: number; size?: number }>(), { size: 16 });
const COLOR = [
  'var(--color-fg-subtle)',
  'var(--color-priority-urgent)',
  'var(--color-priority-high)',
  'var(--color-priority-medium)',
  'var(--color-priority-low)',
];
const color = computed(() => COLOR[props.priority] ?? COLOR[0]);
// высота столбиков: срочно — «!» в квадрате; high/medium/low — 3/2/1 заполненных из 3
const lit = computed(() => [0, 0, 3, 2, 1][props.priority] ?? 0);
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    class="shrink-0"
    aria-hidden="true"
    :style="{ color }"
  >
    <template v-if="priority === 1">
      <rect x="1" y="1" width="14" height="14" rx="3.5" fill="currentColor" />
      <path d="M8 4.5v4.5" stroke="var(--color-bg)" stroke-width="2" stroke-linecap="round" />
      <circle cx="8" cy="11.8" r="1.2" fill="var(--color-bg)" />
    </template>
    <path
      v-else-if="!lit"
      d="M3 8h10"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    />
    <template v-else>
      <rect
        v-for="(h, i) in [5, 9, 13]"
        :key="i"
        :x="1.5 + i * 5"
        :y="14 - h"
        width="3.5"
        :height="h"
        rx="1"
        fill="currentColor"
        :opacity="i < lit ? 1 : 0.28"
      />
    </template>
  </svg>
</template>
