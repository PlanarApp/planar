import { watch } from 'vue';
import type { Router } from 'vue-router';
import { domainMutators } from '@planar/shared';
import { useAuth } from './auth/useAuth';
import { persistStorage } from './pwa/storage';
import { moduleMutators, onUnauthorized, registerMutators, startSync, stopSync } from './sync';

/** Connects user login with sync: called once from main.ts. */
export function initSession(router: Router): void {
  registerMutators([...domainMutators, ...moduleMutators]);
  const { user, expire, lastSetupInfo, mfaSetup, locked } = useAuth();
  watch(
    // cloud trial is over — the server closes sync too (cloud-link); 2FA setup and the lock — too
    () =>
      lastSetupInfo.value?.cloud?.expired || mfaSetup.value || locked.value
        ? undefined
        : user.value?.id,
    (userId) => {
      if (!userId) return void stopSync();
      void startSync({ userId });
      void persistStorage();
    },
    { immediate: true },
  );
  onUnauthorized(() => {
    expire();
    void router.push('/login');
  });
}
