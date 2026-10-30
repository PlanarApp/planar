<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { Button, Dialog } from '../ui';
import { usePwa } from './usePwa';

const open = defineModel<boolean>('open', { default: false });
const { t } = useI18n();
const { canInstall, isIos, install } = usePwa();

async function go() {
  await install();
  open.value = false;
}
</script>

<template>
  <Dialog v-model:open="open" size="sm" :title="t('pwa.installTitle')">
    <p class="text-sm">{{ t('pwa.installWhy') }}</p>
    <p v-if="isIos" class="mt-2 text-sm" data-testid="ios-help">{{ t('pwa.iosHelp') }}</p>
    <p v-else-if="!canInstall" class="mt-2 text-sm text-fg-muted">{{ t('pwa.installNA') }}</p>
    <template #footer>
      <Button @click="open = false">{{ t('pwa.close') }}</Button>
      <Button v-if="!isIos && canInstall" variant="primary" @click="go">
        {{ t('pwa.install') }}
      </Button>
    </template>
  </Dialog>
</template>
