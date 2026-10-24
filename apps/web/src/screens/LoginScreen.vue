<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Button, Input } from '../ui';
import { useAuth } from '../auth/useAuth';
import { errText } from '../auth/errText';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { login } = useAuth();
const loginV = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    await login(loginV.value, password.value);
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
  <main class="flex min-h-dvh items-center justify-center bg-bg p-4">
    <div
      class="flex w-full max-w-[360px] flex-col gap-4 rounded-lg border border-border bg-surface p-6"
    >
      <header>
        <p class="text-xl font-semibold">{{ t('app.name') }}</p>
        <h1 class="text-sm text-fg-muted">{{ t('screens.login') }}</h1>
      </header>
      <form class="flex flex-col gap-3" @submit.prevent="submit">
        <Input v-model="loginV" :label="t('auth.login')" />
        <Input v-model="password" type="password" :label="t('auth.password')" :error="error" />
        <Button type="submit" variant="primary" class="w-full" :loading="busy">{{
          t('auth.signIn')
        }}</Button>
      </form>
    </div>
  </main>
</template>
