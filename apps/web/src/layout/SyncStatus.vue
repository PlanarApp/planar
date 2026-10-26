<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { CloudOff, RefreshCw, TriangleAlert, Check } from 'lucide-vue-next';
import { syncState } from '../sync';

// статус соединения и синхронизации (PWA): офлайн и сколько правок ждут, отправка, ошибка; после — «синхронизировано»
const { t } = useI18n();
const net = ref(typeof navigator === 'undefined' ? true : navigator.onLine);
const setNet = () => (net.value = navigator.onLine);
onMounted(() => {
  addEventListener('online', setNet);
  addEventListener('offline', setNet);
});
onBeforeUnmount(() => {
  removeEventListener('online', setNet);
  removeEventListener('offline', setNet);
});
const state = computed<'offline' | 'error' | 'sync' | 'ok'>(() => {
  const s = syncState.value;
  if (!net.value || s.status === 'offline') return 'offline';
  if (s.status === 'error') return 'error';
  if (s.status === 'bootstrapping' || s.pending > 0) return 'sync';
  return 'ok';
});
// после офлайна/отправки — коротко «синхронизировано»
const done = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
watch(state, (now, was) => {
  if (now === 'ok' && (was === 'offline' || was === 'sync')) {
    done.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => (done.value = false), 3000);
  }
});
onBeforeUnmount(() => clearTimeout(timer));
const pending = computed(() => syncState.value.pending);
</script>

<template>
  <span
    v-if="state !== 'ok' || done"
    role="status"
    data-testid="sync-status"
    :data-state="state"
    :title="state === 'offline' ? t('pwa.offlineHint') : undefined"
    :class="[
      'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs',
      state === 'offline'
        ? 'bg-bg-muted text-fg-muted'
        : state === 'error'
          ? 'bg-danger-subtle text-danger'
          : 'text-fg-muted',
    ]"
  >
    <CloudOff v-if="state === 'offline'" :size="14" aria-hidden="true" />
    <TriangleAlert v-else-if="state === 'error'" :size="14" aria-hidden="true" />
    <RefreshCw v-else-if="state === 'sync'" :size="14" class="animate-spin" aria-hidden="true" />
    <Check v-else :size="14" aria-hidden="true" />
    <span class="max-md:hidden">{{
      state === 'offline'
        ? pending
          ? t('pwa.offlinePending', { n: pending })
          : t('pwa.offline')
        : state === 'error'
          ? t('pwa.syncError')
          : state === 'sync'
            ? t('pwa.syncing')
            : t('pwa.synced')
    }}</span>
  </span>
</template>
