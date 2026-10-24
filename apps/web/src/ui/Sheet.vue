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

// Лист снизу для mobile (Popover/Menu/Select); закрытие — подложка и Esc (Reka Dialog)
defineProps<{ title?: string }>();
const { t } = useI18n();
const open = defineModel<boolean>('open', { default: false });
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogTrigger as-child><slot name="trigger" /></DialogTrigger>
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-overlay" />
      <DialogContent
        data-testid="sheet"
        aria-describedby="undefined"
        class="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-auto rounded-t-lg border-t border-border bg-surface p-1 pb-[env(safe-area-inset-bottom)] text-fg outline-none"
      >
        <DialogTitle class="sr-only">{{ title || t('ui.sheet') }}</DialogTitle>
        <slot />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
