<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Button, Input } from '../ui';
import { useAuth } from '../auth/useAuth';
import { errText } from '../auth/errText';
import FactorForm from '../auth/FactorForm.vue';
import { passkeySupported, type Proof } from '../api/security';
import { api } from '../api/http';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { login, demoLogin, setupInfo, mfaPending, verifyMfa, passkeyLogin } = useAuth();
const demo = ref(false);
// cloud-link: the trial is over — only admins can sign in (to pay)
const expired = ref(false);
onMounted(async () => {
  const info = await setupInfo().catch(() => null);
  demo.value = info?.demo ?? false;
  expired.value = !!info?.cloud?.expired;
});
const loginV = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

const next = () => {
  const r = route.query.redirect;
  return router.replace(typeof r === 'string' && r.startsWith('/') ? r : '/');
};

async function submit(mode: 'password' | 'demo' | 'passkey' = 'password') {
  error.value = '';
  busy.value = true;
  try {
    if (mode === 'demo') await demoLogin();
    else if (mode === 'passkey') await passkeyLogin();
    else await login(loginV.value, password.value);
    if (!mfaPending.value) await next();
  } catch (e) {
    // the browser passkey dialog was closed — not an error worth a message
    if (!(e instanceof Error && e.name === 'NotAllowedError')) error.value = errText(e, t);
  } finally {
    busy.value = false;
  }
}

async function second(p: Proof) {
  await verifyMfa(p);
  await next();
}

// back to the password: the pending session is dropped on the server (the local replica stays)
function back() {
  mfaPending.value = null;
  password.value = '';
  void api('POST', '/api/auth/logout').catch(() => {});
}
</script>

<template>
  <main class="flex min-h-dvh items-center justify-center bg-bg-subtle p-4">
    <div
      class="flex w-full max-w-[360px] flex-col gap-6 rounded-lg border border-border bg-surface p-6 shadow-sm"
    >
      <header class="flex flex-col items-center gap-2 text-center">
        <span
          class="flex size-10 items-center justify-center rounded-lg bg-accent text-lg font-semibold text-accent-fg"
          aria-hidden="true"
          >{{ t('app.name').slice(0, 1) }}</span
        >
        <p class="text-xl font-semibold">{{ t('app.name') }}</p>
        <h1 class="text-sm text-fg-muted">{{ t('screens.login') }}</h1>
      </header>
      <p
        v-if="expired"
        role="alert"
        class="rounded-md bg-danger-subtle p-3 text-sm text-danger"
        data-testid="trial-expired"
      >
        {{ t('cloud.loginExpired') }}
      </p>
      <template v-if="mfaPending">
        <p class="text-center text-sm text-fg-muted">{{ t('security.secondStep') }}</p>
        <FactorForm :totp="mfaPending.totp" :passkey="mfaPending.passkey" :verify="second" />
        <Button variant="ghost" class="w-full" @click="back">{{ t('security.back') }}</Button>
      </template>
      <form v-else class="flex flex-col gap-3" @submit.prevent="submit()">
        <Input v-model="loginV" :label="t('auth.login')" />
        <Input v-model="password" type="password" :label="t('auth.password')" :error="error" />
        <Button type="submit" variant="primary" class="mt-1 w-full" :loading="busy">{{
          t('auth.signIn')
        }}</Button>
        <Button
          v-if="passkeySupported()"
          type="button"
          class="w-full"
          data-testid="login-passkey"
          :loading="busy"
          @click="submit('passkey')"
          >{{ t('security.signInPasskey') }}</Button
        >
        <Button v-if="demo" type="button" class="w-full" :loading="busy" @click="submit('demo')">{{
          t('auth.tryDemo')
        }}</Button>
      </form>
    </div>
  </main>
</template>
