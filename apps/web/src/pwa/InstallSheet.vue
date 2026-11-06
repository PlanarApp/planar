<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button, Sheet } from '../ui';
import { usePwa } from './usePwa';

// install offer (PLNRAPP-67): a bottom sheet once per app load while the app is not installed;
// it opens when the browser allows installing (beforeinstallprompt) or on iOS (manual steps)
const { t } = useI18n();
const { canInstall, isIos, isStandalone, install } = usePwa();
const open = ref(false);
const offer = computed(() => !isStandalone.value && (canInstall.value || isIos));
watch(
  offer,
  (v) => {
    if (v && !offered) open.value = offered = true;
  },
  { immediate: true },
);
async function go() {
  await install();
  open.value = false;
}
</script>

<script lang="ts">
let offered = false; // per page load, not per mount
</script>

<template>
  <Sheet v-model:open="open" :title="t('pwa.installTitle')">
    <div class="mx-auto flex max-w-lg flex-col gap-3 p-4" data-testid="install-sheet">
      <p class="text-base font-medium">{{ t('pwa.installTitle') }}</p>
      <p class="text-sm text-fg-muted">{{ t('pwa.installWhy') }}</p>
      <p v-if="isIos" class="text-sm" data-testid="ios-help">{{ t('pwa.iosHelp') }}</p>
      <div class="flex justify-end gap-2">
        <Button @click="open = false">{{ t('pwa.close') }}</Button>
        <Button v-if="!isIos && canInstall" variant="primary" @click="go">
          {{ t('pwa.install') }}
        </Button>
      </div>
    </div>
  </Sheet>
</template>
