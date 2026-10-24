<script setup lang="ts">
import { Minus, SignalHigh, SignalLow, SignalMedium, OctagonAlert } from 'lucide-vue-next';
import { computed } from 'vue';

const props = defineProps<{ priority: number }>();
const spec = computed(
  () =>
    [
      [Minus, 'var(--color-fg-subtle)'],
      [OctagonAlert, 'var(--color-priority-urgent)'],
      [SignalHigh, 'var(--color-priority-high)'],
      [SignalMedium, 'var(--color-priority-medium)'],
      [SignalLow, 'var(--color-priority-low)'],
    ][props.priority] ?? [Minus, 'var(--color-fg-subtle)'],
);
</script>

<template>
  <component :is="spec[0]" :size="16" aria-hidden="true" :style="{ color: spec[1] as string }" />
</template>
