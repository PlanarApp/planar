<script setup lang="ts">
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';

defineProps<{ title: string; description?: string }>();
const open = defineModel<boolean>('open', { default: false });
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-black/40" />
      <DialogContent
        class="fixed z-50 flex flex-col gap-3 bg-surface p-4 text-fg shadow-lg outline-none inset-0 md:inset-auto md:left-1/2 md:top-1/2 md:w-[480px] md:max-w-[calc(100vw-2rem)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:border md:border-border"
      >
        <DialogTitle class="text-lg font-semibold">{{ title }}</DialogTitle>
        <DialogDescription v-if="description" class="text-sm text-fg-muted">
          {{ description }}
        </DialogDescription>
        <div class="flex-1 overflow-auto"><slot /></div>
        <div v-if="$slots.footer" class="flex justify-end gap-2"><slot name="footer" /></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
