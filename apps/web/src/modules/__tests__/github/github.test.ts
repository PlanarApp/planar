// PLNRAPP-890: the GitHub settings page of a level — connect with a token, the error under the field,
// disconnect with a confirmation; a space / project picks a parent's connection or adds its own (as GitLab)
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { TooltipProvider } from 'reka-ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../../i18n';
import Settings from '../../../../../../modules/github/web/GithubSettings.vue';

const WS = '00000000-0000-0000-0000-000000000000';
const P = '11111111-1111-4111-8111-111111111111';
type Conn = {
  id: string;
  scope: string;
  scopeId: string;
  login: string;
  connectedBy: string;
  connectedAt: string;
};
const mk = (id: string, scope: string, scopeId: string, login: string): Conn => ({
  id,
  scope,
  scopeId,
  login,
  connectedBy: 'u1',
  connectedAt: '2026-11-27T10:00:00.000Z',
});
let calls: { method: string; path: string; body: unknown }[];
let conns: Conn[];
let choices: Record<string, string>;
let postReply: (() => { status: number; body: unknown }) | null;
const res = (status: number, body?: unknown) => ({
  status,
  ok: status < 400,
  json: async () => body ?? {},
});

beforeEach(() => {
  calls = [];
  conns = [];
  choices = {};
  postReply = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, o: { method: string; body?: string }) => {
      const body = o.body && JSON.parse(o.body);
      calls.push({ method: o.method, path, body });
      if (o.method === 'POST') {
        if (postReply) {
          const r = postReply();
          return res(r.status, r.body);
        }
        const c = mk(`c${conns.length + 1}`, body.scope, body.scopeId, 'octo-cat');
        conns.push(c);
        if (body.scope !== 'workspace') choices[body.scope] = c.id;
        return res(201, { connection: c });
      }
      if (o.method === 'DELETE') {
        const id = path.split('/').pop();
        conns = conns.filter((c) => c.id !== id);
        return res(204);
      }
      if (o.method === 'PUT') {
        const scope = path.split('/')[4]!;
        if (body.connectionId) choices[scope] = body.connectionId;
        else delete choices[scope];
        return res(200, { choice: body.connectionId });
      }
      const scope = path.split('/')[4]!;
      const choice = choices[scope] ?? null;
      const ws = conns.find((c) => c.scope === 'workspace');
      return res(200, {
        connections: conns.filter((c) => c.scope === 'workspace' || c.scope === scope),
        choice,
        effective: choice ?? ws?.id ?? null,
      });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

const mountIt = async (
  props: { level: 'workspace' | 'space' | 'project'; projectId?: string } = { level: 'workspace' },
) => {
  const Host = defineComponent({ render: () => h(TooltipProvider, () => h(Settings, props)) });
  const w = mount(Host, { global: { plugins: [i18n] }, attachTo: document.body });
  await flushPromises();
  return w;
};
const submit = async (w: Awaited<ReturnType<typeof mountIt>>, token: string) => {
  await w.get('[data-testid=gh-token]').setValue(token);
  await w.get('[data-testid=gh-form]').trigger('submit');
  await flushPromises();
};

describe('github: настройки воркспейса', () => {
  it('не подключено — поле токена; «Подключить» шлёт токен уровня и показывает логин', async () => {
    const w = await mountIt();
    expect(calls[0]).toMatchObject({ method: 'GET', path: `/api/github/levels/workspace/${WS}` });
    expect(w.find('[data-testid=gh-none]').exists()).toBe(true);
    await submit(w, 'ghp_TOKEN');
    expect(calls.find((c) => c.method === 'POST')).toMatchObject({
      path: '/api/github/connections',
      body: { scope: 'workspace', scopeId: WS, token: 'ghp_TOKEN' },
    });
    expect(w.get('[data-testid=gh-login]').text()).toBe('octo-cat');
    expect(w.find('[data-testid=gh-none]').exists()).toBe(false);
    expect(w.html()).not.toContain('ghp_TOKEN');
  });

  it('невалидный токен — текст ошибки под полем ввода', async () => {
    postReply = () => ({
      status: 400,
      body: {
        code: 'invalid_request',
        message: 'Токен GitHub недействителен или не имеет доступа',
      },
    });
    const w = await mountIt();
    await submit(w, 'ghp_bad');
    const input = w.get('[data-testid=gh-token]');
    const errId = input.attributes('aria-describedby')!;
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(w.get(`#${CSS.escape(errId)}`).text()).toBe(
      'Токен GitHub недействителен или не имеет доступа',
    );
    expect(w.find('[data-testid=gh-login]').exists()).toBe(false);
  });

  it('«Отключить» с подтверждением удаляет подключение; поле токена на месте', async () => {
    conns = [mk('c1', 'workspace', WS, 'octo-cat')];
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
      path: '/api/github/connections/c1',
    });
    expect(w.find('[data-testid=gh-token]').exists()).toBe(true);
    expect(w.find('[data-testid=gh-login]').exists()).toBe(false);
  });
});

describe('github: настройки проекта', () => {
  it('наследует подключение воркспейса; «Своё подключение» — поле токена и подключение уровня проекта', async () => {
    conns = [mk('c1', 'workspace', WS, 'octo-ws')];
    const w = await mountIt({ level: 'project', projectId: P });
    expect(calls[0]).toMatchObject({ path: `/api/github/levels/project/${P}` });
    const sel = w.get('[data-testid=gh-choice]');
    expect((sel.element as HTMLSelectElement).value).toBe('');
    expect(sel.text()).toContain('octo-ws');
    expect(w.find('[data-testid=gh-form]').exists()).toBe(false);
    await sel.setValue('__new');
    await flushPromises();
    await submit(w, 'ghp_PROJ');
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      scope: 'project',
      scopeId: P,
      token: 'ghp_PROJ',
    });
    expect(w.get('[data-testid=gh-login]').text()).toBe('octo-cat');
    expect(w.find('[data-testid=gh-form]').exists()).toBe(false);
  });

  it('выбор подключения уровня выше и возврат к наследованию', async () => {
    conns = [mk('c1', 'workspace', WS, 'octo-a'), mk('c2', 'workspace', WS, 'octo-b')];
    const w = await mountIt({ level: 'project', projectId: P });
    await w.get('[data-testid=gh-choice]').setValue('c2');
    await flushPromises();
    expect(calls.find((c) => c.method === 'PUT')).toMatchObject({
      path: `/api/github/levels/project/${P}/choice`,
      body: { connectionId: 'c2' },
    });
    await w.get('[data-testid=gh-choice]').setValue('');
    await flushPromises();
    expect(calls.filter((c) => c.method === 'PUT').at(-1)!.body).toEqual({ connectionId: null });
  });
});
