import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { TooltipProvider } from 'reka-ui';
import { defineComponent, h } from 'vue';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { registerModules } from '../../modules/registry';
import { ACTIVITY_POLL_MS } from '../../modules/activity';
import type { WorkActivity } from '../../modules/types';
import TaskAiStatus from '../TaskAiStatus.vue';

// PLNRAPP-322/323/324: the AI status in a list row / on a board card — one source per project for all rows
const P = crypto.randomUUID();
let answer: WorkActivity[] = [];
const load = vi.fn(async (projectId: string) => (projectId === P ? answer : []));
registerModules([{ id: 'ai-row-test', activity: [{ id: 'p', entity: 'projects', load }] }]);
const Empty = defineComponent({ render: () => null });
const task = (key: string) => ({ id: `id-${key}`, key, projectId: P });
let w: VueWrapper | undefined;

async function render(keys: string[]) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:p(.*)*', component: Empty }],
  });
  const i18n = createI18n({ legacy: false, locale: 'ru', messages: { ru, en } });
  w = mount(
    defineComponent({
      render: () =>
        h(TooltipProvider, null, () =>
          keys.map((k) => h('div', { 'data-row': k }, [h(TaskAiStatus, { task: task(k) })])),
        ),
    }),
    { global: { plugins: [i18n, router] } },
  );
  await flushPromises();
}
const icon = (k: string) => w!.find(`[data-row="${k}"] [data-testid="ai-status"]`);

beforeEach(() => {
  answer = [];
  load.mockClear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  w?.unmount();
  w = undefined;
  vi.useRealTimers();
});

describe('TaskAiStatus: статус ИИ в строке списка и на карточке доски', () => {
  it('один запрос на проект; работает — спиннер, упал — ошибка со ссылкой на запуск, нет запусков — ничего', async () => {
    const at = new Date().toISOString();
    answer = [
      { id: 'r1', itemId: 'id-A-1', state: 'running', startedAt: at, panel: 'runs' },
      {
        id: 'r2',
        itemId: 'id-A-2',
        state: 'failed',
        startedAt: at,
        finishedAt: at,
        error: 'провайдер недоступен',
        panel: 'runs',
      },
    ];
    await render(['A-1', 'A-2', 'A-3']);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(P);
    expect(icon('A-1').attributes('data-state')).toBe('running');
    expect(icon('A-2').attributes('data-state')).toBe('failed');
    expect(icon('A-2').attributes('href')).toBe('/t/A-2?panel=ai-row-test%3Aruns');
    expect(icon('A-2').attributes('aria-label')).toContain('провайдер недоступен');
    expect(icon('A-3').exists()).toBe(false);
  });

  it('пока ИИ работает — опрос; успешное завершение — индикатор пропадает без перезагрузки', async () => {
    answer = [
      { id: 'r1', itemId: 'id-B-1', state: 'running', startedAt: new Date().toISOString() },
    ];
    await render(['B-1']);
    expect(icon('B-1').exists()).toBe(true);
    answer = [];
    await vi.advanceTimersByTimeAsync(ACTIVITY_POLL_MS);
    await flushPromises();
    expect(load).toHaveBeenCalledTimes(2);
    expect(icon('B-1').exists()).toBe(false);
    // nothing runs — no more polling
    await vi.advanceTimersByTimeAsync(ACTIVITY_POLL_MS * 3);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('строки ушли — источник проекта остановлен, новые строки грузят заново', async () => {
    answer = [
      { id: 'r1', itemId: 'id-C-1', state: 'running', startedAt: new Date().toISOString() },
    ];
    await render(['C-1', 'C-2']);
    w!.unmount();
    w = undefined;
    await vi.advanceTimersByTimeAsync(ACTIVITY_POLL_MS * 3);
    expect(load).toHaveBeenCalledTimes(1);
    answer = [];
    await render(['C-1']);
    expect(load).toHaveBeenCalledTimes(2);
    expect(icon('C-1').exists()).toBe(false);
  });
});
