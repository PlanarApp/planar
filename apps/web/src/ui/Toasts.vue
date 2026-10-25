<script setup lang="ts">
import { X } from 'lucide-vue-next';
import { dismiss, toasts } from './toast';
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-16 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-4"
    role="status"
    aria-live="polite"
  >
    <div
      v-for="x in toasts"
      :key="x.id"
      class="pointer-events-auto flex max-w-md items-start gap-2 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-fg shadow-lg"
      data-testid="toast"
    >
      <span class="min-w-0 flex-1 break-words">{{ x.text }}</span>
      <button
        type="button"
        class="text-fg-muted hover:text-fg"
        aria-label="×"
        @click="dismiss(x.id)"
      >
        <X :size="14" />
      </button>
    </div>
  </div>
</template>
