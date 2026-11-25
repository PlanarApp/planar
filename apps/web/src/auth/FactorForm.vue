<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Button, Input } from '../ui';
import { ApiError } from '../api/http';
import { passkeyProof, passkeySupported, type Proof } from '../api/security';
import { errText } from './errText';

// second factor: sign-in after the password and the lock screen
const props = defineProps<{
  totp: boolean;
  passkey: boolean;
  verify: (p: Proof) => Promise<void>;
}>();
const { t } = useI18n();
const code = ref('');
const error = ref('');
const busy = ref(false);

/** Error text of a code or passkey attempt */
function factorErr(e: unknown): string {
  if (e instanceof ApiError && e.code === 'invalid_credentials') return t('security.badCode');
  // the browser dialog was closed or timed out
  if (e instanceof Error && e.name === 'NotAllowedError') return t('security.passkeyCancelled');
  return errText(e, t);
}

async function run(get: () => Promise<Proof> | Proof) {
  error.value = '';
  busy.value = true;
  try {
    await props.verify(await get());
  } catch (e) {
    error.value = factorErr(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <Button
      v-if="passkey && passkeySupported()"
      variant="primary"
      class="w-full"
      data-testid="factor-passkey"
      :loading="busy"
      @click="run(passkeyProof)"
      >{{ t('security.usePasskey') }}</Button
    >
    <form
      v-if="totp"
      class="flex flex-col gap-3"
      @submit.prevent="run(() => ({ code: code.trim() }))"
    >
      <Input
        v-model="code"
        :label="t('security.code')"
        inputmode="numeric"
        autocomplete="one-time-code"
        data-testid="factor-code"
      />
      <p class="text-xs text-fg-muted">{{ t('security.codeHint') }}</p>
      <Button type="submit" :variant="passkey ? 'secondary' : 'primary'" :loading="busy">{{
        t('security.confirm')
      }}</Button>
    </form>
    <p v-if="error" role="alert" class="text-sm text-danger">{{ error }}</p>
  </div>
</template>
