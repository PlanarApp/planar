<script setup lang="ts">
import { computed } from 'vue';
import { Minus, OctagonAlert, SignalHigh, SignalLow, SignalMedium } from 'lucide-vue-next';

const props = withDefaults(defineProps<{ priority: number; size?: number }>(), { size: 16 });
const ICON = [Minus, OctagonAlert, SignalHigh, SignalMedium, SignalLow];
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
  <component
    :is="ICON[idx]"
    :size="size"
    :stroke-width="2.5"
    class="shrink-0"
    aria-hidden="true"
    :style="{ color: COLOR[idx] }"
  />
</template>
