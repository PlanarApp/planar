<script setup lang="ts">
import type { Component } from 'vue';
import { ref } from 'vue';
import { useBreakpoint } from './useBreakpoint';
import Sheet from './Sheet.vue';
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

const props = withDefaults(
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
const { isMobile } = useBreakpoint();
const sheet = ref(false);
</script>

<template>
  <Sheet v-if="isMobile" v-model:open="sheet" :title="label">
    <template #trigger>
      <button
        type="button"
        :aria-label="label"
        :disabled="disabled"
        :class="[
          'inline-flex h-11 items-center justify-between gap-2 rounded-md border border-border-strong bg-bg px-2 text-sm text-fg outline-none focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50',
        ]"
      >
        <!-- nothing picked: the label stands in, otherwise the button is an empty box -->
        <span v-if="props.options.some((o) => o.value === model)" class="truncate">{{
          props.options.find((o) => o.value === model)!.label
        }}</span>
        <span v-else class="truncate text-fg-subtle">{{ placeholder ?? label }}</span>
        <ChevronDown :size="16" class="text-fg-subtle" />
      </button>
    </template>
    <div role="listbox" :aria-label="label">
      <button
        v-for="o in options"
        :key="o.value"
        type="button"
        role="option"
        :aria-selected="o.value === model"
        :class="[
          'flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-fg outline-none',
          o.value === model && 'bg-accent-subtle',
        ]"
        @click="((model = o.value), (sheet = false))"
      >
        <component :is="o.icon" v-if="o.icon" :size="16" :style="{ color: o.color }" />
        <span v-else-if="o.color" class="size-2 rounded-full" :style="{ background: o.color }" />
        {{ o.label }}
      </button>
    </div>
  </Sheet>
  <SelectRoot v-else v-model="model as string | undefined" :disabled="disabled">
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
