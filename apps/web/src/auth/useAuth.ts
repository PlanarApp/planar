import { computed, ref } from 'vue';
import type { Row } from '@planar/shared';
import { api, ApiError } from '../api/http';

export type User = Row<'users'>;

const KEY = 'planar.user';
const store = (u: User | null) => {
  try {
    if (u) localStorage.setItem(KEY, JSON.stringify(u));
    else localStorage.removeItem(KEY);
  } catch {
    /* хранилище недоступно */
  }
};
const known = (): User | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
};

const user = ref<User | null>(null);
const ready = ref(false);

async function refresh(): Promise<void> {
  try {
    user.value = (await api<{ user: User }>('GET', '/api/auth/me')).user;
    store(user.value);
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    // офлайн/5xx: остаёмся с последним известным пользователем
    if (e.status === 401) ((user.value = null), store(null));
    else user.value = known();
  } finally {
    ready.value = true;
  }
}

async function login(login: string, password: string): Promise<void> {
  user.value = (await api<{ user: User }>('POST', '/api/auth/login', { login, password })).user;
  store(user.value);
}

async function logout(): Promise<void> {
  await api('POST', '/api/auth/logout');
  user.value = null;
  store(null);
}

async function setup(d: { login: string; name: string; password: string }): Promise<void> {
  await api('POST', '/api/setup', d);
  await login(d.login, d.password);
}

async function setupNeeded(): Promise<boolean> {
  try {
    return (await api<{ needed: boolean }>('GET', '/api/setup')).needed;
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) return false;
    throw e;
  }
}

const isAdmin = computed(() => user.value?.role === 'owner' || user.value?.role === 'admin');

export function useAuth() {
  return { user, ready, isAdmin, refresh, login, logout, setup, setupNeeded };
}
