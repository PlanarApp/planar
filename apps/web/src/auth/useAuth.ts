import { computed, ref } from 'vue';
import type { Row } from '@planar/shared';
import { api, ApiError } from '../api/http';

export type User = Row<'users'>;

const user = ref<User | null>(null);
const ready = ref(false);

async function refresh(): Promise<void> {
  try {
    user.value = (await api<{ user: User }>('GET', '/api/auth/me')).user;
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
    user.value = null;
  } finally {
    ready.value = true;
  }
}

async function login(login: string, password: string): Promise<void> {
  user.value = (await api<{ user: User }>('POST', '/api/auth/login', { login, password })).user;
}

async function logout(): Promise<void> {
  await api('POST', '/api/auth/logout');
  user.value = null;
}

async function setup(d: { login: string; name: string; password: string }): Promise<void> {
  await api('POST', '/api/setup', d);
  await login(d.login, d.password);
}

async function setupNeeded(): Promise<boolean> {
  return (await api<{ needed: boolean }>('GET', '/api/setup')).needed;
}

const isAdmin = computed(() => user.value?.role === 'owner' || user.value?.role === 'admin');

export function useAuth() {
  return { user, ready, isAdmin, refresh, login, logout, setup, setupNeeded };
}
