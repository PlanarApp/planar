<script setup lang="ts">
import type { Option } from './OptionPicker.vue';

defineProps<{ title: string; chosen: Option[]; compact?: boolean; empty?: string }>();
</script>

<template>
  <button
    type="button"
    :aria-label="title"
    class="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md px-1.5 text-sm text-fg outline-none hover:bg-bg-muted focus-visible:ring-2 ring-focus"
  >
    <component
      :is="o.icon"
      v-for="o in compact ? chosen.slice(0, 1) : chosen"
      :key="o.id"
      v-bind="o.iconProps"
    />
    <span v-if="!compact" class="truncate">{{
      chosen.length ? chosen.map((o) => o.label).join(', ') : (empty ?? '—')
    }}</span>
  </button>
</template>
