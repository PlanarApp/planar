<script setup lang="ts">
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from 'reka-ui';
import { useI18n } from 'vue-i18n';

// Bottom sheet for mobile (Popover/Menu/Select); closing — backdrop and Esc (Reka Dialog)
defineProps<{ title?: string }>();
const { t } = useI18n();
const open = defineModel<boolean>('open', { default: false });
// focus the sheet itself, not its first field: a focused search input opens the phone keyboard over the list
const focusSheet = (e: Event) => {
  e.preventDefault();
  (e.target as HTMLElement | null)?.focus();
};
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogTrigger as-child><slot name="trigger" /></DialogTrigger>
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-overlay" />
      <DialogContent
        data-testid="sheet"
        :aria-describedby="undefined"
        @open-auto-focus="focusSheet"
        class="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-auto rounded-t-lg border-t border-border bg-surface p-1 pb-[env(safe-area-inset-bottom)] text-fg outline-none"
      >
        <DialogTitle class="sr-only">{{ title || t('ui.sheet') }}</DialogTitle>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
