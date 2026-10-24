<script setup lang="ts">
import type { Component } from 'vue';
import { X } from 'lucide-vue-next';

defineProps<{
  color?: string;
  icon?: Component;
  removable?: boolean;
  removeLabel?: string;
}>();
defineEmits<{ remove: [] }>();
</script>

<template>
  <span class="inline-flex h-5 items-center gap-1 rounded-sm bg-bg-muted px-1.5 text-xs text-fg">
    <span v-if="color" class="size-2 shrink-0 rounded-full" :style="{ background: color }" />
    <component :is="icon" v-if="icon" :size="12" />
    <slot />
    <button
      v-if="removable"
      type="button"
      :aria-label="removeLabel"
      class="-mr-0.5 inline-flex size-4 items-center justify-center rounded-sm text-fg-subtle hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-focus"
      @click="$emit('remove')"
    >
      <X :size="12" />
    </button>
  </span>
</template>
