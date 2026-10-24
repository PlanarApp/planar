<script setup lang="ts">
import type { Component } from 'vue';
import { Loader2 } from 'lucide-vue-next';

withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger-ghost' | 'danger';
    size?: 'sm' | 'md';
    icon?: Component;
    iconRight?: Component;
    loading?: boolean;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
  }>(),
  { variant: 'secondary', size: 'md', type: 'button' },
);

const variants = {
  primary: 'bg-accent text-accent-fg hover:opacity-90',
  secondary: 'bg-bg border border-border-strong text-fg hover:bg-bg-muted',
  ghost: 'text-fg hover:bg-bg-muted',
  'danger-ghost': 'text-danger hover:bg-danger-subtle',
  danger: 'bg-danger text-danger-fg hover:opacity-90',
};
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    :class="[
      'inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium outline-none focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50 disabled:pointer-events-none',
      size === 'sm' ? 'h-11 px-2 md:h-7' : 'h-11 px-3 md:h-8',
      variants[variant],
    ]"
  >
    <Loader2 v-if="loading" :size="16" class="animate-spin" />
    <component :is="icon" v-else-if="icon" :size="16" />
    <slot />
    <component :is="iconRight" v-if="iconRight" :size="16" />
  </button>
</template>
