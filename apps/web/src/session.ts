import { watch } from 'vue';
import type { Router } from 'vue-router';
import { domainMutators } from '@planar/shared';
import { useAuth } from './auth/useAuth';
import { moduleMutators, onUnauthorized, registerMutators, startSync, stopSync } from './sync';

/** Connects user login with sync: called once from main.ts. */
export function initSession(router: Router): void {
  registerMutators([...domainMutators, ...moduleMutators]);
  const { user, expire } = useAuth();
  watch(
    () => user.value?.id,
    (userId) => void (userId ? startSync({ userId }) : stopSync()),
    { immediate: true },
  );
  onUnauthorized(() => {
    expire();
    void router.push('/login');
  });
}
