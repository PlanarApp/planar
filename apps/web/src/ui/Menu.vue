<script setup lang="ts">
import type { Component } from 'vue';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui';

export type MenuItem =
  | {
      id: string;
      label: string;
      icon?: Component;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    }
  | { separator: true };

defineProps<{ items: MenuItem[] }>();
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child><slot name="trigger" /></DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        :side-offset="4"
        align="end"
        class="z-50 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-md"
      >
        <template v-for="(it, i) in items" :key="'separator' in it ? 'sep' + i : it.id">
          <DropdownMenuSeparator v-if="'separator' in it" class="my-1 h-px bg-border" />
          <DropdownMenuItem
            v-else
            :disabled="it.disabled"
            :class="[
              'flex h-11 md:h-8 cursor-default items-center gap-2 rounded-sm px-2 text-base outline-none data-[highlighted]:bg-bg-muted data-[disabled]:opacity-50',
              it.danger ? 'text-danger' : 'text-fg',
            ]"
            @select="it.onSelect()"
          >
            <component :is="it.icon" v-if="it.icon" :size="16" />
            <span class="flex-1">{{ it.label }}</span>
            <kbd v-if="it.shortcut" class="text-xs text-fg-subtle">{{ it.shortcut }}</kbd>
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
