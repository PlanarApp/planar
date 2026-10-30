<script setup lang="ts">
import { X } from 'lucide-vue-next';
import { useI18n } from 'vue-i18n';
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';

withDefaults(defineProps<{ title: string; description?: string; size?: 'sm' | 'md' | 'lg' }>(), {
  size: 'md',
});
const open = defineModel<boolean>('open', { default: false });
const { t } = useI18n();
const widths = { sm: 'md:w-[400px]', md: 'md:w-[560px]', lg: 'md:w-[720px]' };
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-40 bg-overlay" />
      <DialogContent
        :class="[
          'fixed z-50 flex flex-col gap-3 bg-surface p-4 text-fg shadow-dialog outline-none inset-0 md:inset-auto md:left-1/2 md:top-1/2 md:max-w-[calc(100vw-32px)] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:border md:border-border',
          widths[size],
        ]"
      >
        <!-- мобильная: окно во весь экран — закрыть крестиком; tabindex -1 — начальный фокус
             у содержимого (ConfirmDialog — «Отмена»), закрыть с клавиатуры — Esc -->
        <div class="flex items-center gap-2">
          <DialogTitle class="min-w-0 flex-1 text-base font-semibold">{{ title }}</DialogTitle>
          <DialogClose
            tabindex="-1"
            :aria-label="t('ui.close')"
            data-testid="dialog-close"
            class="-my-2 -mr-2 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-fg-muted outline-none hover:bg-bg-muted md:hidden"
          >
            <X :size="18" aria-hidden="true" />
          </DialogClose>
        </div>
        <DialogDescription v-if="description" class="text-sm text-fg-muted">
          {{ description }}
        </DialogDescription>
        <div class="flex-1 overflow-auto"><slot /></div>
        <div v-if="$slots.footer" class="flex justify-end gap-2"><slot name="footer" /></div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
