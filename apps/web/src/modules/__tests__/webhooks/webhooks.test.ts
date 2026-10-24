import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { TooltipProvider } from 'reka-ui';
import { i18n } from '../../../i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Settings from '../../../../../../modules/webhooks/web/WebhooksSettings.vue';

const sub = {
  id: 's1',
  url: 'https://example.com/hook',
  events: ['task.created'],
  active: true,
  description: null,
};
const del = {
  id: 'd1',
  event: 'task.created',
  status: 'failed',
  attempts: 11,
  lastStatus: 500,
  lastError: 'http_500',
  createdAt: '',
};
let calls: { method: string; path: string; body: unknown }[];
const res = (status: number, body?: unknown) => ({
  status,
  ok: status < 400,
  json: async () => body ?? {},
});

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, o: { method: string; body?: string }) => {
      calls.push({ method: o.method, path, body: o.body && JSON.parse(o.body) });
      if (path.endsWith('/subscriptions') && o.method === 'POST')
        return res(201, { data: sub, secret: 'whsec_ONCE' });
      if (path.endsWith('/subscriptions')) return res(200, { data: [sub] });
      if (path.endsWith('/deliveries')) return res(200, { data: [del], nextCursor: null });
      return res(202, { data: del });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const mountIt = async () => {
  const Host = defineComponent({ render: () => h(TooltipProvider, () => h(Settings)) });
  const w = mount(Host, { global: { plugins: [i18n] } });
  await flushPromises();
  return w;
};

describe('wk4:', () => {
  it('wk4: создание показывает секрет один раз и шлёт url и события', async () => {
    const w = await mountIt();
    await w.get('[data-testid=wh-url]').setValue('https://example.com/hook');
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(calls.find((c) => c.method === 'POST')!.body).toMatchObject({
      url: 'https://example.com/hook',
      events: ['task.created', 'task.updated', 'task.deleted', 'comment.created'],
    });
    expect(w.get('[data-testid=wh-secret]').text()).toContain('whsec_ONCE');
    await w.get('[data-testid=wh-secret] button').trigger('click');
    expect(w.find('[data-testid=wh-secret]').exists()).toBe(false);
  });

  it('wk4: журнал доставок и «Повторить» вызывает redeliver', async () => {
    const w = await mountIt();
    expect(w.findAll('[data-testid=wh-sub]')).toHaveLength(1);
    await w.get('[data-testid=wh-log]').trigger('click');
    await flushPromises();
    expect(w.get('[data-testid=wh-delivery]').text()).toContain('500');
    await w.get('[data-testid=wh-redeliver]').trigger('click');
    await flushPromises();
    expect(calls).toContainEqual(
      expect.objectContaining({ method: 'POST', path: '/api/webhooks/deliveries/d1/redeliver' }),
    );
  });

  it('wk4: «Проверить» шлёт ping; ошибка сервера показывается', async () => {
    const w = await mountIt();
    await w.get('[data-testid=wh-ping]').trigger('click');
    await flushPromises();
    expect(calls).toContainEqual(
      expect.objectContaining({ path: '/api/webhooks/subscriptions/s1/ping' }),
    );
    vi.mocked(fetch).mockResolvedValueOnce(res(403, { message: 'Нужна роль' }) as never);
    await w.get('[data-testid=wh-log]').trigger('click');
    await flushPromises();
    expect(w.get('[role=alert]').text()).toBe('Нужна роль');
  });
});
