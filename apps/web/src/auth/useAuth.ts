import { computed, ref } from 'vue';
import type { Row } from '@planar/shared';
import { api, ApiError } from '../api/http';
import { passkeyProof, type Proof } from '../api/security';
import { clearLocal, syncState } from '../sync';

/** timezone — only in the own profile (/api/auth/me), not in the users replica */
export type User = Row<'users'> & { timezone?: string | null };

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

// a known user opens the app at once (warm start): /me is revalidated in the background (router.ts)
const user = ref<User | null>(known());
const ready = ref(!!user.value);
/** startup requests must not hang the screen on a dead network */
const BOOT_TIMEOUT = 8000;
/** the password is accepted, the second factor is pending: which factors the user has */
const mfaPending = ref<{ totp: boolean; passkey: boolean } | null>(null);
/** 2FA is required by the instance policy and not set up: only the security settings */
const mfaSetup = ref(false);
/** app lock (auth/lock.ts): settings and the current state */
const lockPrefs = ref<{ onOpen: boolean; minutes: number | null; wipe: boolean }>({
  onOpen: false,
  minutes: null,
  wipe: false,
});
const locked = ref(false);
/** a factor is set up: «Lock» in the user menu */
const canLock = ref(false);

type Me = {
  user: User;
  mfaSetup?: boolean;
  locked?: boolean;
  lockOnOpen?: boolean;
  lockMinutes?: number | null;
  lockWipe?: boolean;
  canLock?: boolean;
};
function signedIn(r: Me) {
  mfaPending.value = null;
  user.value = r.user;
  store(r.user);
  mfaSetup.value = !!r.mfaSetup;
  if (r.lockMinutes !== undefined)
    lockPrefs.value = { onOpen: !!r.lockOnOpen, minutes: r.lockMinutes, wipe: !!r.lockWipe };
  locked.value = !!r.locked;
  if (r.canLock !== undefined) canLock.value = r.canLock;
  adoptBrowserZone(r.user);
}

/** PLNRAPP-160: the profile has no zone yet — save the browser's one (in the background, no error shown) */
function adoptBrowserZone(u: User) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (u.timezone !== null || !timezone) return; // undefined — the server does not know the field
  api<{ user: User }>('PATCH', `/api/users/${u.id}`, { timezone })
    .then((r) => {
      if (user.value?.id !== r.user.id) return;
      user.value = r.user;
      store(r.user);
    })
    .catch(() => {});
}

async function refresh(): Promise<void> {
  try {
    signedIn(await api<Me>('GET', '/api/auth/me', undefined, undefined, BOOT_TIMEOUT));
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    // offline/5xx: stay with the last known user
    user.value = e.status === 401 ? null : known();
    if (e.status === 401) store(null);
  } finally {
    ready.value = true;
  }
}

/** With 2FA set up — fills mfaPending, then verifyMfa finishes the sign-in. */
async function login(login: string, password: string): Promise<void> {
  const r = await api<Me & { mfa?: { totp: boolean; passkey: boolean } }>(
    'POST',
    '/api/auth/login',
    { login, password },
  );
  if (r.mfa) mfaPending.value = r.mfa;
  else signedIn(r);
}

async function verifyMfa(p: Proof): Promise<void> {
  signedIn(await api<Me>('POST', '/api/auth/mfa/verify', p));
  await refresh(); // lock settings
}

async function passkeyLogin(): Promise<void> {
  signedIn(await api<Me>('POST', '/api/auth/passkey/login', await passkeyProof()));
  await refresh();
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
  locked.value = false;
  mfaSetup.value = false;
  await clearLocal();
  return true;
}

/** Sign in as a user of a lower role (PLNRAPP-129): the replica is that user's now — cleared, the app reloads. */
async function impersonate(userId: string): Promise<void> {
  if (syncState.value.pending > 0 && !(await confirmLoss())) return;
  await api('POST', '/api/auth/impersonate', { userId });
  store(null);
  await clearLocal();
  location.assign('/');
}

// instance admins sign in only downwards by instance role (the server checks too)
const RANK: Record<string, number> = { guest: 0, member: 1, admin: 2, owner: 3 };
function canImpersonate(u: Pick<User, 'role' | 'deactivatedAt'>): boolean {
  const mine = RANK[user.value?.role ?? ''] ?? 0;
  return mine >= RANK.admin! && !u.deactivatedAt && (RANK[u.role] ?? RANK.owner!) < mine;
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
const SETUP_KEY = 'planar.setup';
const lastSetupInfo = ref<SetupInfo | null>(
  (() => {
    try {
      return JSON.parse(localStorage.getItem(SETUP_KEY) ?? 'null');
    } catch {
      return null;
    }
  })(),
);
let setupFlight: Promise<SetupInfo> | null = null;

/** concurrent callers (router guard, App.vue) share one request */
function setupInfo(): Promise<SetupInfo> {
  return (setupFlight ??= fetchSetup().finally(() => (setupFlight = null)));
}

async function fetchSetup(): Promise<SetupInfo> {
  try {
    const s = (lastSetupInfo.value = await api<SetupInfo>(
      'GET',
      '/api/setup',
      undefined,
      undefined,
      BOOT_TIMEOUT,
    ));
    try {
      localStorage.setItem(SETUP_KEY, JSON.stringify(s));
    } catch {
      /* storage unavailable */
    }
    return s;
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
  signedIn(await api<Me>('POST', '/api/auth/demo-login'));
}

const isAdmin = computed(() => user.value?.role === 'owner' || user.value?.role === 'admin');

export function useAuth() {
  return {
    user,
    ready,
    isAdmin,
    refresh,
    login,
    verifyMfa,
    passkeyLogin,
    mfaPending,
    mfaSetup,
    lockPrefs,
    locked,
    canLock,
    logout,
    impersonate,
    canImpersonate,
    logoutPrompt,
    expire,
    setup,
    setupNeeded,
    setupInfo,
    lastSetupInfo,
    demoLogin,
  };
}
