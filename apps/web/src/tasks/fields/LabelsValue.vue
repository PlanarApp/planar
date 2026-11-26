<script setup lang="ts">
import type { Row } from '@planar/shared';
import { Tag } from '@lucide/vue';

// a task's labels: a tag icon in the label's color, with the "Show label names" option — and the name
defineProps<{ labels: Row<'labels'>[]; names?: boolean }>();
</script>

<template>
  <span class="flex min-w-0 items-center gap-1 overflow-hidden">
    <span
      v-for="l in labels"
      :key="l.id"
      class="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium text-fg-muted"
      :title="names ? undefined : l.name"
      data-testid="card-tag"
      ><Tag
        :size="names ? 12 : 14"
        class="shrink-0 text-fg-subtle"
        :aria-label="names ? undefined : l.name"
        :aria-hidden="names || undefined"
        :style="l.color ? { color: l.color } : undefined"
      /><template v-if="names">{{ l.name }}</template></span
    >
  </span>
</template>
