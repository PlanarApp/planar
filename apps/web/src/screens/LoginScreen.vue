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
  <main class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-4 p-4">
    <h1 class="text-xl font-semibold">{{ t('screens.login') }}</h1>
    <form class="flex flex-col gap-3" @submit.prevent="submit">
      <Input v-model="loginV" :label="t('auth.login')" />
      <Input v-model="password" type="password" :label="t('auth.password')" :error="error" />
      <Button type="submit" variant="primary" :loading="busy">{{ t('auth.signIn') }}</Button>
    </form>
  </main>
</template>
