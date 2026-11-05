<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Button, Input } from '../ui';
import { useAuth } from '../auth/useAuth';
import { errText } from '../auth/errText';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { login, demoLogin, setupInfo } = useAuth();
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

async function submit(demoMode = false) {
  error.value = '';
  busy.value = true;
  try {
    if (demoMode) await demoLogin();
    else await login(loginV.value, password.value);
    const r = route.query.redirect;
    await router.replace(typeof r === 'string' && r.startsWith('/') ? r : '/');
  } catch (e) {
    error.value = errText(e, t);
  } finally {
    busy.value = false;
  }
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
      <form class="flex flex-col gap-3" @submit.prevent="submit()">
        <Input v-model="loginV" :label="t('auth.login')" />
        <Input v-model="password" type="password" :label="t('auth.password')" :error="error" />
        <Button type="submit" variant="primary" class="mt-1 w-full" :loading="busy">{{
          t('auth.signIn')
        }}</Button>
        <Button v-if="demo" type="button" class="w-full" :loading="busy" @click="submit(true)">{{
          t('auth.tryDemo')
        }}</Button>
      </form>
    </div>
  </main>
</template>
