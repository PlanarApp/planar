import { describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import { createI18n } from 'vue-i18n';
import { TooltipProvider } from 'reka-ui';
import { createMemoryHistory, createRouter } from 'vue-router';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { registerModules } from '../../modules/registry';
import type { WorkActivity } from '../../modules/types';
import AiCell from '../list/AiCell.vue';

// PLNRAPP-401: the AI columns of the list
const P = crypto.randomUUID();
const at = new Date().toISOString();
const usage = { runs: 2, seconds: 150, inputTokens: 10, outputTokens: 5, cost: 0.123 };
const answer: WorkActivity[] = [
  { id: 'r1', itemId: 'id-A', state: 'done', startedAt: at, usage },
  { id: 'r2', itemId: 'id-B', state: 'failed', startedAt: at },
];
registerModules([
  {
    id: 'ai-cell-test',
    activity: [{ id: 'p', entity: 'projects', load: async (p) => (p === P ? answer : []) }],
  },
]);
const task = (k: string) => ({ id: `id-${k}`, key: k, projectId: P });

describe('AiCell', () => {
  it('ячейки: статус, $ и время; без запусков — прочерк', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:p(.*)*', component: defineComponent({ render: () => null }) }],
    });
    const i18n = createI18n({ legacy: false, locale: 'ru', messages: { ru, en } });
    const w = mount(
      defineComponent({
        render: () =>
          h(TooltipProvider, null, () => [
            h(AiCell, { task: task('A'), col: 'ai' }),
            h(AiCell, { task: task('A'), col: 'aiCost' }),
            h(AiCell, { task: task('A'), col: 'aiTime' }),
            h(AiCell, { task: task('C'), col: 'aiCost' }),
          ]),
      }),
      { global: { plugins: [i18n, router] } },
    );
    await flushPromises();
    expect(w.find('[data-testid="cell-ai"]').text()).toBe('Готово');
    expect(w.find('[data-testid="cell-aiCost"]').text()).toBe('$0.12');
    expect(w.find('[data-testid="cell-aiTime"]').text()).toBe('3 мин');
    expect(w.findAll('[data-testid="cell-aiCost"]')[1]!.text()).toBe('—');
    w.unmount();
  });
});
