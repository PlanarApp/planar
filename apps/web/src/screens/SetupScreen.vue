<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { Button, Input } from '../ui';
import { ApiError } from '../api/http';
import { useAuth } from '../auth/useAuth';
import { errText } from '../auth/errText';

const { t } = useI18n();
const router = useRouter();
const { setup } = useAuth();
const f = reactive({ login: '', name: '', password: '', repeat: '' });
const errors = reactive({ login: '', name: '', password: '', repeat: '', form: '' });
const busy = ref(false);

async function submit() {
  errors.login = f.login.trim() ? '' : t('auth.required');
  errors.name = f.name.trim() ? '' : t('auth.required');
  errors.password = f.password.length >= 8 ? '' : t('auth.tooShort');
  errors.repeat = f.repeat === f.password ? '' : t('auth.mismatch');
  errors.form = '';
  if (errors.login || errors.name || errors.password || errors.repeat) return;
  busy.value = true;
  try {
    await setup({ login: f.login.trim(), name: f.name.trim(), password: f.password });
    await router.replace('/');
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) await router.replace('/login');
    else errors.form = errText(e, t);
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
        <h1 class="text-sm text-fg-muted">{{ t('auth.setupTitle') }}</h1>
      </header>
      <form class="flex flex-col gap-3" @submit.prevent="submit">
        <Input v-model="f.login" :label="t('auth.login')" :error="errors.login" />
        <Input v-model="f.name" :label="t('auth.name')" :error="errors.name" />
        <Input
          v-model="f.password"
          type="password"
          :label="t('auth.password')"
          :error="errors.password"
        />
        <Input
          v-model="f.repeat"
          type="password"
          :label="t('auth.repeat')"
          :error="errors.repeat || errors.form"
        />
        <Button type="submit" variant="primary" class="w-full" :loading="busy">{{
          t('auth.create')
        }}</Button>
      </form>
    </div>
  </main>
</template>
