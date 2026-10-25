<script setup lang="ts">
import { ref, useSlots, type Component } from 'vue';
import { MoreHorizontal } from 'lucide-vue-next';
import IconButton from './IconButton.vue';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from 'reka-ui';
import { useBreakpoint } from './useBreakpoint';
import Sheet from './Sheet.vue';
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

const props = withDefaults(
  defineProps<{
    items: MenuItem[];
    side?: 'top' | 'right' | 'bottom' | 'left';
    align?: 'start' | 'center' | 'end';
    /** подпись кнопки «…», когда слота trigger нет */
    label?: string;
    /** контекстное меню: открывается правым кликом (долгим нажатием) по содержимому слота default */
    context?: boolean;
  }>(),
  { align: 'start' },
);

const hasTrigger = !!useSlots().trigger;
if (import.meta.env.DEV && !hasTrigger && !props.label && !props.context)
  console.warn('Menu: нужен слот trigger или label');
const { isMobile } = useBreakpoint();
const sheet = ref(false);
const pending = ref<Item | null>(null);
const confirmOpen = ref(false);
const select = (it: Item) => {
  if (!it.confirm) return it.onSelect();
  pending.value = it;
  confirmOpen.value = true;
};
const pick = (it: Item) => {
  sheet.value = false;
  select(it);
};
const confirmed = () => pending.value?.onSelect();
</script>

<template>
  <ContextMenuRoot v-if="context">
    <ContextMenuTrigger as-child><slot /></ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent
        class="z-50 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-popover"
      >
        <template v-for="(it, i) in items" :key="'separator' in it ? 'sep' + i : it.id">
          <ContextMenuSeparator v-if="'separator' in it" class="my-1 h-px bg-border" />
          <ContextMenuItem
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
          </ContextMenuItem>
        </template>
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
  <Sheet v-else-if="isMobile" v-model:open="sheet">
    <template #trigger
      ><slot name="trigger"
        ><IconButton :icon="MoreHorizontal" :label="label ?? ''" size="sm" /></slot
    ></template>
    <template v-for="(it, i) in items" :key="'separator' in it ? 'sep' + i : it.id">
      <div v-if="'separator' in it" class="my-1 h-px bg-border" />
      <button
        v-else
        type="button"
        :disabled="it.disabled"
        :class="[
          'flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none disabled:opacity-50',
          it.danger ? 'text-danger' : 'text-fg',
        ]"
        @click="pick(it)"
      >
        <component :is="it.icon" v-if="it.icon" :size="16" />
        <span class="flex-1">{{ it.label }}</span>
      </button>
    </template>
  </Sheet>
  <DropdownMenuRoot v-else>
    <DropdownMenuTrigger as-child
      ><slot name="trigger"
        ><IconButton :icon="MoreHorizontal" :label="label ?? ''" size="sm" /></slot
    ></DropdownMenuTrigger>
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
