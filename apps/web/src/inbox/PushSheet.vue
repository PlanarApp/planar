<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button, Sheet } from '../ui';
import { overlayOpen } from '../ui/overlay';
import { api } from '../api/http';
import { enablePush, isSubscribed, needsInstall, pushSupported } from './push';

// push offer: a bottom sheet once per app load while this device is not subscribed (like InstallSheet);
// not when the browser has blocked notifications or the server has no VAPID keys
const { t } = useI18n();
const open = ref(false);
const msg = ref('');
let timer: ReturnType<typeof setInterval> | undefined;

async function eligible(): Promise<boolean> {
  if (!pushSupported() || needsInstall() || Notification.permission === 'denied') return false;
  if (await isSubscribed().catch(() => true)) return false;
  return !!(await api('GET', '/api/push/vapid').catch(() => null));
}

onMounted(async () => {
  if (offered || !(await eligible())) return;
  // waits for other sheets and dialogs (the install offer goes first)
  timer = setInterval(() => {
    if (overlayOpen()) return;
    clearInterval(timer);
    open.value = offered = true;
  }, 2000);
});
onUnmounted(() => clearInterval(timer));

async function go() {
  msg.value = '';
  const r = await enablePush().catch(() => 'failed' as const);
  if (r === 'ok') open.value = false;
  else
    msg.value = t(
      {
        denied: 'inbox.pushDenied',
        unsupported: 'inbox.pushUnsupported',
        unconfigured: 'inbox.pushUnconfigured',
        failed: 'inbox.pushFailed',
      }[r],
    );
}
</script>

<script lang="ts">
let offered = false; // per page load, not per mount
</script>

<template>
  <Sheet v-model:open="open" :title="t('inbox.pushOfferTitle')">
    <div class="mx-auto flex max-w-lg flex-col gap-3 p-4" data-testid="push-sheet">
      <p class="text-base font-medium">{{ t('inbox.pushOfferTitle') }}</p>
      <p class="text-sm text-fg-muted">{{ t('inbox.pushOfferWhy') }}</p>
      <p v-if="msg" role="alert" class="text-sm text-danger">{{ msg }}</p>
      <div class="flex justify-end gap-2">
        <Button @click="open = false">{{ t('pwa.close') }}</Button>
        <Button variant="primary" data-testid="push-allow" @click="go">{{
          t('inbox.pushOfferAllow')
        }}</Button>
      </div>
    </div>
  </Sheet>
</template>
