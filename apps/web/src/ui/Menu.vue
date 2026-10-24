<script setup lang="ts">
import { ref, type Component } from 'vue';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui';
import ConfirmDialog from './ConfirmDialog.vue';
import Kbd from './Kbd.vue';

type Item = {
  id: string;
  label: string;
  icon?: Component;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  confirm?: { title: string; description?: string; confirmLabel: string };
  onSelect: () => void;
};
export type MenuItem = Item | { separator: true };

withDefaults(
  defineProps<{
    items: MenuItem[];
    side?: 'top' | 'right' | 'bottom' | 'left';
    align?: 'start' | 'center' | 'end';
  }>(),
  { align: 'start' },
);

const pending = ref<Item | null>(null);
const confirmOpen = ref(false);
const select = (it: Item) => {
  if (!it.confirm) return it.onSelect();
  pending.value = it;
  confirmOpen.value = true;
};
const confirmed = () => pending.value?.onSelect();
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger as-child><slot name="trigger" /></DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        :side="side"
        :align="align"
        :side-offset="4"
        class="z-50 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-popover"
      >
        <template v-for="(it, i) in items" :key="'separator' in it ? 'sep' + i : it.id">
          <DropdownMenuSeparator v-if="'separator' in it" class="my-1 h-px bg-border" />
          <DropdownMenuItem
            v-else
            :disabled="it.disabled"
            :class="[
              'flex h-11 md:h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none data-[disabled]:opacity-50',
              it.danger
                ? 'text-danger data-[highlighted]:bg-danger-subtle'
                : 'text-fg data-[highlighted]:bg-bg-muted',
            ]"
            @select="select(it)"
          >
            <component :is="it.icon" v-if="it.icon" :size="16" />
            <span class="flex-1">{{ it.label }}</span>
            <Kbd v-if="it.shortcut" :keys="it.shortcut" />
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
  <ConfirmDialog
    v-if="pending?.confirm"
    v-model:open="confirmOpen"
    :title="pending.confirm.title"
    :description="pending.confirm.description"
    :confirm-label="pending.confirm.confirmLabel"
    @confirm="confirmed"
  />
</template>
