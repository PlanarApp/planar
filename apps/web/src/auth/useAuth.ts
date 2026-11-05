import { computed, ref } from 'vue';
import type { Row } from '@planar/shared';
import { api, ApiError } from '../api/http';
import { clearLocal, syncState } from '../sync';

export type User = Row<'users'>;

const KEY = 'planar.user';
const store = (u: User | null) => {
  try {
    if (u) localStorage.setItem(KEY, JSON.stringify(u));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
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
    // offline/5xx: stay with the last known user
    user.value = e.status === 401 ? null : known();
    if (e.status === 401) store(null);
  } finally {
    ready.value = true;
  }
}

async function login(login: string, password: string): Promise<void> {
  user.value = (await api<{ user: User }>('POST', '/api/auth/login', { login, password })).user;
  store(user.value);
}

// logout confirmation when there are unsent changes (dialog — sync/LogoutDialog.vue)
const promptOpen = ref(false);
let promptResolve: ((ok: boolean) => void) | null = null;
const logoutPrompt = {
  open: promptOpen,
  answer(ok: boolean) {
    promptOpen.value = false;
    promptResolve?.(ok);
    promptResolve = null;
  },
};
const confirmLoss = () =>
  new Promise<boolean>((resolve) => {
    promptResolve?.(false);
    promptResolve = resolve;
    promptOpen.value = true;
  });

/** true — logged out; false — cancelled or no network (then nothing is cleared) */
async function logout(): Promise<boolean> {
  if (syncState.value.pending > 0 && !(await confirmLoss())) return false;
  try {
    await api('POST', '/api/auth/logout');
  } catch (e) {
    // the cookie is HttpOnly and server-side: without a server response, local logout won't clear it
    if (e instanceof ApiError && e.code === 'network') return false;
    throw e;
  }
  user.value = null;
  store(null);
  await clearLocal();
  return true;
}

/** session expired (401): log out locally, replica and queue remain */
function expire(): void {
  user.value = null;
  store(null);
}

/** token — SETUP_TOKEN, sent as X-Setup-Token */
async function setup(
  d: { login: string; name: string; password: string },
  token?: string,
): Promise<void> {
  await api('POST', '/api/setup', d, token ? { 'X-Setup-Token': token } : undefined);
  await login(d.login, d.password);
}

export type SetupInfo = {
  needed: boolean;
  tokenRequired: boolean;
  demo: boolean;
  demoResetHours: number;
  /** cloud-link: null — a self-hosted instance */
  cloud?: {
    status: 'trial' | 'active' | 'expired' | null;
    trialEndsAt: string | null;
    expired: boolean;
  } | null;
};

/** last GET /api/setup answer (the router guard fetches it before the setup screen and once per session) */
const lastSetupInfo = ref<SetupInfo | null>(null);

async function setupInfo(): Promise<SetupInfo> {
  try {
    return (lastSetupInfo.value = await api<SetupInfo>('GET', '/api/setup'));
  } catch (e) {
    if (e instanceof ApiError && e.status === 0)
      return { needed: false, tokenRequired: false, demo: false, demoResetHours: 24 };
    throw e;
  }
}

async function setupNeeded(): Promise<boolean> {
  return (await setupInfo()).needed;
}

async function demoLogin(): Promise<void> {
  user.value = (await api<{ user: User }>('POST', '/api/auth/demo-login')).user;
  store(user.value);
}

const isAdmin = computed(() => user.value?.role === 'owner' || user.value?.role === 'admin');

export function useAuth() {
  return {
    user,
    ready,
    isAdmin,
    refresh,
    login,
    logout,
    logoutPrompt,
    expire,
    setup,
    setupNeeded,
    setupInfo,
    lastSetupInfo,
    demoLogin,
  };
}
