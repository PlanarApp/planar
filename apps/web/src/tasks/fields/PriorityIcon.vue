<script setup lang="ts">
import { computed } from 'vue';
import { Minus, OctagonAlert, SignalHigh, SignalMedium } from 'lucide-vue-next';

const props = withDefaults(defineProps<{ priority: number; size?: number }>(), { size: 16 });
const ICON = [Minus, OctagonAlert, SignalHigh, SignalMedium, Minus]; // 4 рисуется svg ниже;
const COLOR = [
  'var(--color-fg-subtle)',
  'var(--color-priority-urgent)',
  'var(--color-priority-high)',
  'var(--color-priority-medium)',
  'var(--color-priority-low)',
];
const idx = computed(() => (props.priority in ICON ? props.priority : 0));
</script>

<template>
  <!-- у lucide SignalLow — точка и короткая черта, на 16px нечитаемо: рисуем три столбика с одним активным -->
  <svg
    v-if="idx === 4"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    class="shrink-0"
    aria-hidden="true"
    :style="{ color: COLOR[idx] }"
  >
    <path d="M6 20v-6" />
    <path d="M12 20v-10" opacity=".3" />
    <path d="M18 20V4" opacity=".3" />
  </svg>
  <component
    v-else
    :is="ICON[idx]"
    :size="size"
    :stroke-width="2.5"
    class="shrink-0"
    aria-hidden="true"
    :style="{ color: COLOR[idx] }"
  />
</template>
