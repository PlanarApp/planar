<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Avatar, Button } from '../ui';
import { api } from '../api/http';
import { getSecurity, type Proof } from '../api/security';
import { useAuth } from './useAuth';
import FactorForm from './FactorForm.vue';

const { t } = useI18n();
const { user, locked, logout } = useAuth();
const f = ref<{ totp: boolean; passkey: boolean } | null>(null);

onMounted(async () => {
  const s = await getSecurity().catch(() => null);
  // unknown (offline) — offer both: the server decides
  f.value = s ? { totp: s.totp, passkey: s.passkeys.length > 0 } : { totp: true, passkey: true };
});

async function signOut() {
  if (await logout().catch(() => false)) location.assign('/login');
}

async function unlock(p: Proof) {
  await api('POST', '/api/auth/unlock', p);
  locked.value = false;
}
</script>

<template>
  <main
    class="fixed inset-0 z-50 flex items-center justify-center bg-bg-subtle p-4"
    data-testid="lock-screen"
    :aria-label="t('security.locked')"
  >
    <div
      class="flex w-full max-w-[360px] flex-col gap-6 rounded-lg border border-border bg-surface p-6 shadow-sm"
    >
      <header class="flex flex-col items-center gap-2 text-center">
        <Avatar v-if="user" :name="user.name" size="lg" />
        <p class="text-lg font-semibold">{{ user?.name }}</p>
        <h1 class="text-sm text-fg-muted">{{ t('security.locked') }}</h1>
      </header>
      <FactorForm v-if="f" :totp="f.totp" :passkey="f.passkey" :verify="unlock" />
      <Button variant="ghost" class="w-full" @click="signOut">{{ t('auth.signOut') }}</Button>
    </div>
  </main>
</template>
