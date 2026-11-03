<script setup lang="ts">
import { computed, ref, useSlots, type Component } from 'vue';
import { Check, ChevronRight, MoreHorizontal } from 'lucide-vue-next';
import IconButton from './IconButton.vue';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuRoot,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from 'reka-ui';
import { useBreakpoint } from './useBreakpoint';
import Sheet from './Sheet.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import Kbd from './Kbd.vue';

/** submenu item: value choice (status, priority…); checked — the current one */
export type SubItem = {
  id: string;
  label: string;
  icon?: Component;
  iconProps?: Record<string, unknown>;
  checked?: boolean;
  onSelect: () => void;
};
type Item = {
  id: string;
  label: string;
  icon?: Component;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  confirm?: { title: string; description?: string; confirmLabel: string };
  /** submenu instead of an action (one level) */
  children?: SubItem[];
  onSelect?: () => void;
};
export type MenuItem = Item | { separator: true };

const props = withDefaults(
  defineProps<{
    items: MenuItem[];
    side?: 'top' | 'right' | 'bottom' | 'left';
    align?: 'start' | 'center' | 'end';
    /** label of the "…" button when there is no trigger slot */
    label?: string;
    /** context menu: opens by right-click (long press) on the content of the default slot */
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
  if (!it.confirm) return it.onSelect?.();
  pending.value = it;
  confirmOpen.value = true;
};
const pick = (f: () => void) => {
  sheet.value = false;
  f();
};
/** The action opened an inline field (data-inline-edit): the focus trap of the menu took focus from it — give the focus to the field, not the trigger. */
const keepEditing = (e: Event) => {
  const f = document.querySelector<HTMLElement>('[data-inline-edit]');
  if (!f) return;
  e.preventDefault();
  f.focus();
};
const confirmed = () => pending.value?.onSelect?.();

// the same reka components for two kinds of menu
const kind = computed(() =>
  props.context
    ? {
        Content: ContextMenuContent,
        Item: ContextMenuItem,
        Portal: ContextMenuPortal,
        Separator: ContextMenuSeparator,
        Sub: ContextMenuSub,
        SubContent: ContextMenuSubContent,
        SubTrigger: ContextMenuSubTrigger,
      }
    : {
        Content: DropdownMenuContent,
        Item: DropdownMenuItem,
        Portal: DropdownMenuPortal,
        Separator: DropdownMenuSeparator,
        Sub: DropdownMenuSub,
        SubContent: DropdownMenuSubContent,
        SubTrigger: DropdownMenuSubTrigger,
      },
);
const panel = 'z-50 min-w-44 rounded-lg border border-border bg-surface p-1 shadow-popover';
const row = (danger?: boolean) => [
  'flex h-11 md:h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none data-[disabled]:opacity-50',
  danger
    ? 'text-danger data-[highlighted]:bg-danger-subtle'
    : 'text-fg data-[highlighted]:bg-bg-muted data-[state=open]:bg-bg-muted',
];
const subPanel = `${panel} max-h-80 overflow-y-auto`;
</script>

<template>
  <Sheet v-if="isMobile && !context" v-model:open="sheet">
    <template #trigger
      ><slot name="trigger"
        ><IconButton :icon="MoreHorizontal" :label="label ?? ''" size="sm" /></slot
    ></template>
    <template v-for="(it, i) in items" :key="'separator' in it ? 'sep' + i : it.id">
      <div v-if="'separator' in it" class="my-1 h-px bg-border" />
      <template v-else-if="it.children">
        <div class="px-2 pt-2 text-xs font-medium text-fg-muted">{{ it.label }}</div>
        <button
          v-for="c in it.children"
          :key="c.id"
          type="button"
          class="flex min-h-11 w-full items-center gap-2 rounded-md px-2 pl-4 text-left text-sm text-fg outline-none"
          @click="pick(c.onSelect)"
        >
          <component :is="c.icon" v-if="c.icon" :size="16" v-bind="c.iconProps" />
          <span class="flex-1">{{ c.label }}</span>
          <Check v-if="c.checked" :size="14" />
        </button>
      </template>
      <button
        v-else
        type="button"
        :disabled="it.disabled"
        :class="[
          'flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none disabled:opacity-50',
          it.danger ? 'text-danger' : 'text-fg',
        ]"
        @click="pick(() => select(it))"
      >
        <component :is="it.icon" v-if="it.icon" :size="16" />
        <span class="flex-1">{{ it.label }}</span>
      </button>
    </template>
  </Sheet>
  <component :is="context ? ContextMenuRoot : DropdownMenuRoot" v-else>
    <ContextMenuTrigger v-if="context" as-child><slot /></ContextMenuTrigger>
    <DropdownMenuTrigger v-else as-child
      ><slot name="trigger"
        ><IconButton :icon="MoreHorizontal" :label="label ?? ''" size="sm" /></slot
    ></DropdownMenuTrigger>
    <component :is="kind.Portal">
      <component
        :is="kind.Content"
        v-bind="context ? {} : { side, align, sideOffset: 4 }"
        :class="panel"
        @close-auto-focus="keepEditing"
      >
        <template v-for="(it, i) in items" :key="'separator' in it ? 'sep' + i : it.id">
          <component :is="kind.Separator" v-if="'separator' in it" class="my-1 h-px bg-border" />
          <component :is="kind.Sub" v-else-if="it.children">
            <component :is="kind.SubTrigger" :disabled="it.disabled" :class="row()">
              <component :is="it.icon" v-if="it.icon" :size="16" />
              <span class="flex-1">{{ it.label }}</span>
              <ChevronRight :size="14" class="text-fg-muted" />
            </component>
            <component :is="kind.Portal">
              <component :is="kind.SubContent" :side-offset="4" :class="subPanel">
                <component
                  :is="kind.Item"
                  v-for="c in it.children"
                  :key="c.id"
                  :class="row()"
                  @select="c.onSelect()"
                >
                  <component :is="c.icon" v-if="c.icon" :size="16" v-bind="c.iconProps" />
                  <span class="flex-1 truncate">{{ c.label }}</span>
                  <Check v-if="c.checked" :size="14" class="text-accent" />
                </component>
              </component>
            </component>
          </component>
          <component
            :is="kind.Item"
            v-else
            :disabled="it.disabled"
            :class="row(it.danger)"
            @select="select(it)"
          >
            <component :is="it.icon" v-if="it.icon" :size="16" />
            <span class="flex-1">{{ it.label }}</span>
            <Kbd v-if="it.shortcut" :keys="it.shortcut" />
          </component>
        </template>
      </component>
    </component>
  </component>
  <ConfirmDialog
    v-if="pending?.confirm"
    v-model:open="confirmOpen"
    :title="pending.confirm.title"
    :description="pending.confirm.description"
    :confirm-label="pending.confirm.confirmLabel"
    @confirm="confirmed"
  />
</template>
