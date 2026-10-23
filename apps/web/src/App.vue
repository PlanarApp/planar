<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useRegisterSW } from 'virtual:pwa-register/vue';
import { TooltipProvider } from 'reka-ui';
import CommandHost from './command/CommandHost.vue';
import AppShell from './layout/AppShell.vue';
import { Button, useTheme } from './ui';

useTheme();
const route = useRoute();
const { t } = useI18n();
const bare = computed(() => route.meta.layout === 'none');
const { needRefresh, updateServiceWorker } = useRegisterSW();
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
