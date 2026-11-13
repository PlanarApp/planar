import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import EgressSection from './EgressSection.vue';

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));
const egress = (mode: string, domains: string[] = []) => ({ egress: { mode, domains } });

afterEach(() => vi.unstubAllGlobals());

describe('PLNRAPP-242 EgressSection', () => {
  it('не в облаке (404) — формы нет', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => json(404, { message: 'Инстанс не в облаке' })),
    );
    const w = mount(EgressSection);
    await flushPromises();
    expect(w.find('[data-testid="ai-egress"]').exists()).toBe(false);
  });

  it('список доменов уходит в облако нормализованным; неверный домен — подсказка без запроса; open — null', async () => {
    const f = vi.fn((url: string, init?: RequestInit) =>
      url === '/api/cloud'
        ? json(200, egress('open'))
        : json(200, egress('allowlist', JSON.parse(init!.body as string).domains ?? [])),
    );
    vi.stubGlobal('fetch', f);
    const w = mount(EgressSection);
    await flushPromises();
    expect((w.get('[data-testid="ai-egress-open"]').element as HTMLInputElement).checked).toBe(
      true,
    );
    await w.get('[data-testid="ai-egress-list"]').setValue();
    await w.get('[data-testid="ai-egress-domains"]').setValue('GitLab.com\nhttp_access!');
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(w.get('[data-testid="ai-egress-error"]').text()).toContain('http_access!');
    expect(f).toHaveBeenCalledTimes(1);
    await w.get('[data-testid="ai-egress-domains"]').setValue('GitLab.com, .npmjs.org');
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(f.mock.calls[1]![0]).toBe('/api/cloud/egress');
    expect(JSON.parse(f.mock.calls[1]![1]!.body as string)).toEqual({
      domains: ['gitlab.com', '.npmjs.org'],
    });
    expect(w.find('[data-testid="ai-egress-saved"]').exists()).toBe(true);
    await w.get('[data-testid="ai-egress-open"]').setValue();
    await w.get('form').trigger('submit');
    await flushPromises();
    expect(JSON.parse(f.mock.calls[2]![1]!.body as string)).toEqual({ domains: null });
  });
});
