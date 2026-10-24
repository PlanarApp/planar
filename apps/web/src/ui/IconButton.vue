<script setup lang="ts">
import type { Component } from 'vue';
import Tooltip from './Tooltip.vue';

withDefaults(
  defineProps<{
    icon: Component;
    label: string;
    variant?: 'ghost' | 'secondary';
    size?: 'sm' | 'md';
    shortcut?: string;
    active?: boolean;
    disabled?: boolean;
  }>(),
  { variant: 'ghost', size: 'md', active: undefined },
);
</script>

<template>
  <Tooltip :content="label" :shortcut="shortcut">
    <button
      type="button"
      :aria-label="label"
      :aria-pressed="active === undefined ? undefined : active"
      :disabled="disabled"
      :class="[
        'inline-flex shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-bg-muted hover:text-fg outline-none focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50 disabled:pointer-events-none',
        size === 'sm' ? 'size-11 md:size-7' : 'size-11 md:size-8',
        variant === 'secondary' && 'border border-border-strong bg-bg',
        active && 'bg-bg-muted text-fg',
      ]"
    >
      <component :is="icon" :size="16" />
    </button>
  </Tooltip>
</template>
