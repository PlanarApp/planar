import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiRunView } from '../shared/index.js';
import RunRow from './RunRow.vue';

// PLNRAPP-336: the run's log opens over the whole screen and returns into the row (button or Esc)
vi.mock('./api', () => ({
  call: vi.fn(async (_m: string, path: string) =>
    path.includes('/events')
      ? { state: 'done', events: [{ id: 1, type: 'thought', text: 'думаю', tool: null }] }
      : { run: { log: 'строка журнала' } },
  ),
}));

const run: AiRunView = {
  id: 'r1',
  taskId: 't1',
  pageId: null,
  projectId: 'p1',
  kind: 'action',
  actionId: null,
  actionName: 'Разработка',
  state: 'done',
  chainDepth: 0,
  restartOf: null,
  inputTokens: 1,
  outputTokens: 2,
  cost: null,
  createdAt: '2026-11-18T00:00:00Z',
  updatedAt: '2026-11-18T00:00:00Z',
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('RunRow: the log on the whole screen', () => {
  it('opens the log over the screen and returns it by the button and by Esc', async () => {
    const w = mount(RunRow, { props: { run, title: 'Задача' }, attachTo: document.body });
    expect(w.find('[data-testid="ai-run-log-full"]').exists()).toBe(false);
    await w.get('[data-testid="ai-run-log"]').trigger('click');
    await flushPromises();
    const box = () => document.querySelector<HTMLElement>('[data-testid="ai-run-log-box"]')!;
    // in the row: inside the component, not fixed
    expect(w.element.contains(box())).toBe(true);
    expect(box().className).not.toContain('fixed');

    await w.get('[data-testid="ai-run-log-full"]').trigger('click');
    await flushPromises();
    expect(w.element.contains(box())).toBe(false);
    expect(box().className).toContain('fixed');
    expect(box().getAttribute('role')).toBe('dialog');
    expect(box().textContent).toContain('думаю');
    expect(box().textContent).toContain('строка журнала');

    box().querySelector<HTMLElement>('[data-testid="ai-run-log-exit-full"]')!.click();
    await flushPromises();
    expect(w.element.contains(box())).toBe(true);

    await w.get('[data-testid="ai-run-log-full"]').trigger('click');
    await flushPromises();
    expect(box().className).toContain('fixed');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await flushPromises();
    expect(w.element.contains(box())).toBe(true);
    expect(box().className).not.toContain('fixed');
    w.unmount();
  });
});
