<script setup lang="ts">
import { computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useRegisterSW } from 'virtual:pwa-register/vue';
import { TooltipProvider } from 'reka-ui';
import CommandHost from './command/CommandHost.vue';
import AppShell from './layout/AppShell.vue';
import Button from './ui/Button.vue';
import { useTheme } from './ui/useTheme';

useTheme();
const route = useRoute();
const { t } = useI18n();
const bare = computed(() => route.meta.layout === 'none');
// обновления PWA: проверка раз в 30 мин и при возврате во вкладку; вкладка в фоне — ставим сразу,
// иначе плашка «Обновить» (не перезагружать посреди ввода)
const CHECK_MS = 30 * 60_000;
let reg: ServiceWorkerRegistration | undefined;
const check = () => void reg?.update().catch(() => {});
const { needRefresh, updateServiceWorker } = useRegisterSW({
  onRegisteredSW(_url, r) {
    reg = r;
    if (r) setInterval(check, CHECK_MS);
  },
});
const applyIfHidden = () => {
  if (needRefresh.value && document.visibilityState === 'hidden') void updateServiceWorker(true);
};
watch(needRefresh, applyIfHidden);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') check();
  else applyIfHidden();
});
</script>

<template>
  <TooltipProvider>
    <RouterView v-if="bare" />
    <AppShell v-else />
    <CommandHost v-if="!bare" />
    <div
      v-if="needRefresh"
      role="status"
      class="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-md md:bottom-4"
    >
      {{ t('pwa.update') }}
      <Button size="sm" variant="primary" @click="updateServiceWorker()">{{
        t('pwa.reload')
      }}</Button>
    </div>
  </TooltipProvider>
</template>
