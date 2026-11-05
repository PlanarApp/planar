<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import { useAuth } from '../auth/useAuth';
import { Button } from '../ui';
import CloudSettings from './settings/CloudSettings.vue';

// cloud-link: the trial is over — the admin sees only payment; the rest of the app is closed by the server
const { t } = useI18n();
const router = useRouter();
const { logout } = useAuth();
const out = async () => (await logout()) && router.replace('/login');
</script>

<template>
  <main class="flex min-h-dvh justify-center bg-bg-subtle p-4">
    <div
      class="flex w-full max-w-2xl flex-col gap-4 self-start rounded-lg border border-border bg-surface p-6 shadow-sm"
    >
      <p role="alert" class="rounded-md bg-danger-subtle p-3 text-sm text-danger">
        {{ t('cloud.paywall') }}
      </p>
      <CloudSettings />
      <div>
        <Button size="sm" @click="out">{{ t('auth.signOut') }}</Button>
      </div>
    </div>
  </main>
</template>
