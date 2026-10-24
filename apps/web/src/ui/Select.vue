<script setup lang="ts">
import type { Component } from 'vue';
import {
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'reka-ui';
import { ChevronDown } from 'lucide-vue-next';

withDefaults(
  defineProps<{
    options: { value: string; label: string; icon?: Component; color?: string }[];
    label: string;
    placeholder?: string;
    disabled?: boolean;
    size?: 'sm' | 'md';
  }>(),
  { size: 'md' },
);
const model = defineModel<string | null>({ default: null });
</script>

<template>
  <SelectRoot v-model="model as string | undefined" :disabled="disabled">
    <SelectTrigger
      :aria-label="label"
      :class="[
        'inline-flex items-center justify-between gap-2 rounded-md border border-border-strong bg-bg px-2 text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50',
        size === 'sm' ? 'h-11 md:h-7' : 'h-11 md:h-8',
      ]"
    >
      <SelectValue :placeholder="placeholder" />
      <ChevronDown :size="16" class="text-fg-subtle" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        position="popper"
        :side-offset="4"
        class="z-50 min-w-[var(--reka-select-trigger-width)] rounded-lg border border-border bg-surface p-1 shadow-popover"
      >
        <SelectViewport>
          <SelectItem
            v-for="o in options"
            :key="o.value"
            :value="o.value"
            class="flex h-11 md:h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm text-fg outline-none data-[highlighted]:bg-bg-muted data-[state=checked]:bg-accent-subtle"
          >
            <component :is="o.icon" v-if="o.icon" :size="16" :style="{ color: o.color }" />
            <span
              v-else-if="o.color"
              class="size-2 rounded-full"
              :style="{ background: o.color }"
            />
            <SelectItemText>{{ o.label }}</SelectItemText>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
