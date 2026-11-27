// PLNRAPP-890: the GitHub settings page — connect with a token, the error under the field, disconnect with a confirmation
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { TooltipProvider } from 'reka-ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../i18n';
import Settings from '../../../../../../modules/github/web/GithubSettings.vue';

const conn = { login: 'octo-cat', connectedBy: 'u1', connectedAt: '2026-11-27T10:00:00.000Z' };
let calls: { method: string; path: string; body: unknown }[];
let state: typeof conn | null;
let putReply: () => { status: number; body: unknown };
const res = (status: number, body?: unknown) => ({
  status,
  ok: status < 400,
  json: async () => body ?? {},
});

beforeEach(() => {
  calls = [];
  state = null;
  putReply = () => ({ status: 200, body: { connection: conn } });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, o: { method: string; body?: string }) => {
      calls.push({ method: o.method, path, body: o.body && JSON.parse(o.body) });
      if (o.method === 'PUT') {
        const r = putReply();
        if (r.status === 200) state = conn;
        return res(r.status, r.body);
      }
      if (o.method === 'DELETE') {
        state = null;
        return res(204);
      }
      return res(200, { connection: state });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const mountIt = async () => {
  const Host = defineComponent({ render: () => h(TooltipProvider, () => h(Settings)) });
  const w = mount(Host, { global: { plugins: [i18n] }, attachTo: document.body });
  await flushPromises();
  return w;
};

describe('github: настройки', () => {
  it('не подключено — поле токена; «Подключить» шлёт токен и показывает логин', async () => {
    const w = await mountIt();
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/github/connection' });
    await w.get('[data-testid=gh-token]').setValue('ghp_TOKEN');
    await w.get('[data-testid=gh-form]').trigger('submit');
    await flushPromises();
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ token: 'ghp_TOKEN' });
    expect(w.get('[data-testid=gh-login]').text()).toBe('octo-cat');
    expect(w.find('[data-testid=gh-token]').exists()).toBe(false);
    expect(w.html()).not.toContain('ghp_TOKEN');
  });

  it('невалидный токен — текст ошибки под полем ввода', async () => {
    putReply = () => ({
      status: 400,
      body: {
        code: 'invalid_request',
        message: 'Токен GitHub недействителен или не имеет доступа',
      },
    });
    const w = await mountIt();
    await w.get('[data-testid=gh-token]').setValue('ghp_bad');
    await w.get('[data-testid=gh-form]').trigger('submit');
    await flushPromises();
    const input = w.get('[data-testid=gh-token]');
    const errId = input.attributes('aria-describedby')!;
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(w.get(`#${CSS.escape(errId)}`).text()).toBe(
      'Токен GitHub недействителен или не имеет доступа',
    );
    expect(w.find('[data-testid=gh-login]').exists()).toBe(false);
  });

  it('«Отключить» с подтверждением удаляет подключение и возвращает поле токена', async () => {
    state = conn;
    const w = await mountIt();
    expect(w.get('[data-testid=gh-login]').text()).toBe('octo-cat');
    await w.get('[data-testid=gh-disconnect]').trigger('click');
    await flushPromises();
    // nothing is deleted before the confirmation
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    const dialog = document.body.querySelector('[role=dialog]');
    expect(dialog).toBeTruthy();
    // the confirm button is the last one in the footer (cancel goes first)
    const buttons = [...dialog!.querySelectorAll('button')];
    buttons[buttons.length - 1]!.click();
    await flushPromises();
    expect(calls.find((c) => c.method === 'DELETE')).toMatchObject({
      path: '/api/github/connection',
    });
    expect(w.find('[data-testid=gh-token]').exists()).toBe(true);
    expect(w.find('[data-testid=gh-login]').exists()).toBe(false);
  });
});
