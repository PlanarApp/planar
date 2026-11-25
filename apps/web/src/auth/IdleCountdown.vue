<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { countdown, stillHere } from './lock';

// idle lock warning: full screen, a click anywhere — the user is here
const { t } = useI18n();
</script>

<template>
  <button
    type="button"
    class="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-bg/95 p-6 text-center outline-none"
    data-testid="idle-countdown"
    :aria-label="t('security.idleStay')"
    @click="stillHere"
  >
    <span class="text-sm text-fg-muted">{{ t('security.idleTitle') }}</span>
    <span class="text-7xl font-semibold tabular-nums" aria-live="polite">{{ countdown }}</span>
    <span class="text-sm">{{ t('security.idleStay') }}</span>
  </button>
</template>
