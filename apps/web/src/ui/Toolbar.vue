<script setup lang="ts">
import { ToolbarRoot } from 'reka-ui';

defineProps<{ label: string }>();
</script>

<template>
  <ToolbarRoot
    :aria-label="label"
    class="flex h-11 shrink-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-border px-2"
  >
    <slot />
    <div class="ml-auto flex items-center gap-1"><slot name="end" /></div>
  </ToolbarRoot>
</template>
