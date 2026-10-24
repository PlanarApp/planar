<script setup lang="ts">
import { useId, type Component } from 'vue';

withDefaults(
  defineProps<{
    label: string;
    hideLabel?: boolean;
    type?: string;
    placeholder?: string;
    error?: string;
    disabled?: boolean;
    size?: 'sm' | 'md';
    icon?: Component;
  }>(),
  { size: 'md' },
);
const model = defineModel<string>({ default: '' });
const id = useId();
</script>

<template>
  <div class="flex flex-col gap-1">
    <label :for="id" :class="hideLabel ? 'sr-only' : 'text-xs text-fg-muted'">{{ label }}</label>
    <div class="relative">
      <component
        :is="icon"
        v-if="icon"
        :size="16"
        class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle"
      />
      <input
        :id="id"
        v-model="model"
        :type="type ?? 'text'"
        :placeholder="placeholder"
        :disabled="disabled"
        :aria-invalid="error ? true : undefined"
        :aria-describedby="error ? id + '-err' : undefined"
        :class="[
          'w-full rounded-md border bg-bg text-sm text-fg placeholder:text-fg-subtle outline-none focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-0 disabled:bg-bg-muted',
          error ? 'border-danger' : 'border-border-strong',
          size === 'sm' ? 'h-11 md:h-7' : 'h-11 md:h-8',
          icon ? 'pl-7 pr-2' : 'px-2',
        ]"
      />
    </div>
    <p v-if="error" :id="id + '-err'" class="text-xs text-danger">{{ error }}</p>
  </div>
</template>
