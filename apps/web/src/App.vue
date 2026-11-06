<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useAuth } from './auth/useAuth';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { TooltipProvider } from 'reka-ui';
import CommandHost from './command/CommandHost.vue';
import AppShell from './layout/AppShell.vue';
import Button from './ui/Button.vue';
import { useTheme } from './ui/useTheme';
import { usePwa } from './pwa/usePwa';

useTheme();
const route = useRoute();
const { t } = useI18n();
const bare = computed(() => route.meta.layout === 'none');
const { needRefresh, downloading, applying, applyUpdate } = usePwa();
// downloading or applying: the text and a running bar instead of the button
const busy = computed(() =>
  downloading.value && !needRefresh.value
    ? t('pwa.downloading')
    : applying.value
      ? t('pwa.applying')
      : '',
);
const { setupInfo } = useAuth();
const demoHours = ref(0);
onMounted(async () => {
  // the banner is optional: a failed /api/setup must not break the app
  const s = await setupInfo().catch(() => null);
  if (s?.demo) demoHours.value = s.demoResetHours;
});
</script>

<template>
  <TooltipProvider>
    <div
      v-if="demoHours"
      role="status"
      class="bg-accent px-3 py-1 text-center text-xs text-accent-fg"
    >
      {{ t('auth.demoBanner', { n: demoHours }) }}
    </div>
    <RouterView v-if="bare" />
    <AppShell v-else />
    <CommandHost v-if="!bare" />
    <div
      v-if="needRefresh || downloading"
      data-testid="pwa-update"
      role="status"
      class="fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-md md:bottom-4"
    >
      <template v-if="busy">
        {{ busy }}
        <span
          role="progressbar"
          :aria-label="busy"
          class="relative h-1.5 w-24 overflow-hidden rounded-full bg-bg-muted"
          data-testid="pwa-progress"
        >
          <span
            class="absolute inset-y-0 left-0 w-2/5 animate-indeterminate rounded-full bg-accent motion-reduce:animate-pulse"
          />
        </span>
      </template>
      <template v-else>
        {{ t('pwa.update') }}
        <Button size="sm" variant="primary" @click="applyUpdate()">
          {{ t('pwa.reload') }}
        </Button>
      </template>
    </div>
  </TooltipProvider>
</template>
