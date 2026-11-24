import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { TASK_ACTIVITY, type Activity } from '@planar/web/modules';
import type { AiRunView } from '../shared/index.js';
import { call } from './api';
import TaskAiPanel from './TaskAiPanel.vue';

// PLNRAPP-532: a run started by a rule (a status change) shows in the «AI» tab without reloading the page
vi.mock('./api', () => ({
  AiApiError: class extends Error {},
  call: vi.fn(async () => ({ runs: [] })),
}));
vi.mock('./RunRow.vue', async () => {
  const { defineComponent, h } = await import('vue');
  return {
    default: defineComponent({
      props: { run: { type: Object, required: true } },
      setup: (p) => () => h('li', { 'data-testid': 'run' }, (p.run as AiRunView).state),
    }),
  };
});

const run = (state: AiRunView['state']): AiRunView => ({
  id: 'r1',
  taskId: 't1',
  pageId: null,
  projectId: 'p1',
  kind: 'action',
  actionId: null,
  actionName: 'Разработка',
  state,
  chainDepth: 0,
  restartOf: null,
  inputTokens: 0,
  outputTokens: 0,
  cost: null,
  createdAt: '2026-11-18T00:00:00Z',
  updatedAt: '2026-11-18T00:00:00Z',
});
const work = (id: string, state: Activity['state']): Activity => ({
  id,
  itemId: null,
  state,
  startedAt: '2026-11-18T00:00:00Z',
  moduleId: 'ai',
});

describe('TaskAiPanel: the work of the task changed', () => {
  it('reloads the runs when the card indicator sees a new run or its new state', async () => {
    const answer = vi.mocked(call);
    const items = ref<Activity[]>([]);
    const w = mount(TaskAiPanel, {
      props: { taskId: 't1' },
      global: { provide: { [TASK_ACTIVITY as symbol]: { items, open() {}, cancel() {} } } },
    });
    await flushPromises();
    expect(w.findAll('[data-testid="run"]')).toHaveLength(0);
    // the rule fired: the indicator sees the queued job, then the run
    answer.mockResolvedValue({ runs: [run('running')] });
    items.value = [work('job1', 'queued')];
    await flushPromises();
    expect(w.find('[data-testid="run"]').text()).toBe('running');
    // the run finished: seen by the indicator, the tab follows
    answer.mockResolvedValue({ runs: [run('done')] });
    items.value = [work('r1', 'done')];
    await flushPromises();
    expect(w.find('[data-testid="run"]').text()).toBe('done');
    w.unmount();
  });
});

// PLNRAPP-829: a manual start by a rule of the project with AI actions
describe('TaskAiPanel: manual start', () => {
  it('lists the rules, starts the picked one and shows its run', async () => {
    const answer = vi.mocked(call);
    let runs: AiRunView[] = [];
    const posted: unknown[] = [];
    answer.mockImplementation(async (method: string, path: string, body?: unknown) => {
      if (path === 'tasks/t1/rules')
        return {
          rules: [
            { id: 'rA', name: 'Разработка', actions: ['Разработка'] },
            { id: 'rB', name: 'Триаж', actions: ['Триаж', 'Оценка'] },
          ],
        };
      if (method === 'POST') {
        posted.push([path, body]);
        runs = [{ ...run('queued'), id: 'new' }];
        return { runIds: ['new'] };
      }
      return { runs };
    });
    const w = mount(TaskAiPanel, { props: { taskId: 't1' } });
    await flushPromises();
    const opts = w.findAll('[data-testid="ai-start-rule"] option');
    expect(opts.map((o) => o.text())).toEqual(['Разработка — Разработка', 'Триаж — Триаж, Оценка']);
    expect(w.findAll('[data-testid="run"]')).toHaveLength(0);
    await w.find('[data-testid="ai-start-rule"]').setValue('rB');
    await w.find('[data-testid="ai-start"]').trigger('submit');
    await flushPromises();
    expect(posted).toEqual([['tasks/t1/runs', { ruleId: 'rB' }]]);
    expect(w.find('[data-testid="run"]').text()).toBe('queued');
    w.unmount();
  });

  it('no rules with AI actions — no start form; a refusal is shown', async () => {
    const answer = vi.mocked(call);
    answer.mockImplementation(async (method: string, path: string) => {
      if (path === 'tasks/t1/rules') return { rules: [] };
      return { runs: [] };
    });
    const w = mount(TaskAiPanel, { props: { taskId: 't1' } });
    await flushPromises();
    expect(w.find('[data-testid="ai-start"]').exists()).toBe(false);
    answer.mockImplementation(async (method: string, path: string) => {
      if (path === 'tasks/t1/rules') return { rules: [{ id: 'rA', name: 'Р', actions: ['Р'] }] };
      if (method === 'POST') throw new Error('Назначьте ИИ исполнителем задачи');
      return { runs: [] };
    });
    await w.setProps({ taskId: 't1x' });
    await w.setProps({ taskId: 't1' });
    await flushPromises();
    await w.find('[data-testid="ai-start"]').trigger('submit');
    await flushPromises();
    expect(w.find('[role="alert"]').text()).toBe('Назначьте ИИ исполнителем задачи');
    w.unmount();
  });
});
