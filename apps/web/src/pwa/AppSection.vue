<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import { Button } from '../ui';
import InstallDialog from './InstallDialog.vue';
import { usePwa } from './usePwa';

const { t } = useI18n();
const route = useRoute();
const pwa = usePwa();
const dialog = ref(false);
const showInstall = computed(() => !pwa.isStandalone.value && (pwa.canInstall.value || pwa.isIos));
const status = computed(() =>
  t(`pwa.state.${pwa.needRefresh.value ? 'available' : pwa.updateState.value}`),
);

// команды палитры ведут сюда через /profile?pwa=check|install
onMounted(() => {
  if (route.query.pwa === 'check') void pwa.checkForUpdates();
  else if (route.query.pwa === 'install') dialog.value = true;
});
</script>

<template>
  <section class="flex flex-col gap-3" :aria-label="t('pwa.section')">
    <h2 class="text-lg font-semibold">{{ t('pwa.section') }}</h2>
    <p class="text-sm text-fg-muted" role="status" data-testid="pwa-status">{{ status }}</p>
    <div class="flex flex-wrap gap-2">
      <Button
        :disabled="pwa.updateState.value === 'checking'"
        data-testid="pwa-check"
        @click="pwa.checkForUpdates()"
      >
        {{ t('pwa.check') }}
      </Button>
      <Button v-if="pwa.needRefresh.value" variant="primary" @click="pwa.applyUpdate()">
        {{ t('pwa.reload') }}
      </Button>
      <Button v-if="showInstall" data-testid="pwa-install" @click="dialog = true">
        {{ t('pwa.installApp') }}
      </Button>
    </div>
    <InstallDialog v-model:open="dialog" />
  </section>
</template>
