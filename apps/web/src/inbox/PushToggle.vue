<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button } from '../ui';
import { disablePush, enablePush, isSubscribed, needsInstall, pushSupported } from './push';

const { t } = useI18n();
const on = ref(false);
const msg = ref('');
const busy = ref(false);
const install = needsInstall();

onMounted(async () => {
  if (!install) on.value = await isSubscribed().catch(() => false);
});

async function toggle() {
  busy.value = true;
  msg.value = '';
  try {
    if (on.value) {
      await disablePush();
      on.value = false;
    } else {
      const r = await enablePush();
      on.value = r === 'ok';
      const msgs = {
        denied: 'inbox.pushDenied',
        unsupported: 'inbox.pushUnsupported',
        unconfigured: 'inbox.pushUnconfigured',
      };
      if (r !== 'ok') msg.value = t(msgs[r]);
    }
  } catch {
    msg.value = t('inbox.pushFailed');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <p v-if="install" data-testid="push-ios" class="text-sm text-fg-muted">
    {{ t('inbox.pushInstall') }}
  </p>
  <div v-else-if="pushSupported()" class="flex items-center gap-2">
    <Button size="sm" :disabled="busy" role="switch" :aria-checked="on" @click="toggle">
      {{ t(on ? 'inbox.pushOff' : 'inbox.pushOn') }}
    </Button>
    <span v-if="msg" role="alert" class="text-sm text-fg-muted">{{ msg }}</span>
  </div>
</template>
