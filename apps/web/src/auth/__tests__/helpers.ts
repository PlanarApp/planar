import { vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { createI18n } from 'vue-i18n';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { useAuth, type User } from '../useAuth';

export const mkUser = (o: Partial<User> = {}): User => ({
  id: '0190-u1',
  login: 'ann',
  name: 'Ann',
  email: null,
  role: 'owner',
  avatarFile: null,
  deactivatedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...o,
});

export const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

type Handler = (method: string, path: string, body: unknown) => Response | undefined;
export function mockFetch(h: Handler) {
  const f = vi.fn(async (path: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    return h(init?.method ?? 'GET', path, body) ?? json(500, { code: 'internal', message: 'x' });
  });
  vi.stubGlobal('fetch', f);
  return f;
}

export const mkI18n = () =>
  createI18n({ legacy: false, locale: 'ru', fallbackLocale: 'ru', messages: { ru, en } });

export const stub = { template: '<div />' };
export function mkRouter(extra: { path: string; component: object; name?: string }[] = []) {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: stub },
      { path: '/login', name: 'login', component: stub, meta: { layout: 'none' } },
      ...extra,
    ],
  });
}

export function resetAuth() {
  const a = useAuth();
  a.user.value = null;
  a.ready.value = false;
}
