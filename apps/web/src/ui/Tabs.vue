<script setup lang="ts">
import type { Component } from 'vue';
import { TabsList, TabsRoot, TabsTrigger } from 'reka-ui';

withDefaults(
  defineProps<{
    items: { value: string; label: string; icon?: Component; count?: number }[];
    label: string;
    size?: 'sm' | 'md';
  }>(),
  { size: 'sm' },
);
const model = defineModel<string>({ default: '' });
</script>

<template>
  <TabsRoot v-model="model" activation-mode="manual">
    <TabsList :aria-label="label" class="flex flex-nowrap gap-1 overflow-x-auto">
      <TabsTrigger
        v-for="i in items"
        :key="i.value"
        :value="i.value"
        :class="[
          'inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium outline-none focus-visible:outline-2 focus-visible:outline-focus data-[state=active]:bg-bg-muted data-[state=active]:text-fg data-[state=inactive]:text-fg-muted data-[state=inactive]:hover:bg-bg-subtle',
          size === 'sm' ? 'h-11 md:h-7' : 'h-11 md:h-8',
        ]"
      >
        <component :is="i.icon" v-if="i.icon" :size="16" />
        {{ i.label }}
        <span v-if="i.count !== undefined" class="text-2xs text-fg-subtle">{{ i.count }}</span>
      </TabsTrigger>
    </TabsList>
  </TabsRoot>
</template>
