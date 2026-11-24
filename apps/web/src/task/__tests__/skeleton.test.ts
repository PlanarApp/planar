import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { TooltipProvider } from 'reka-ui';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import Sidebar from '../../layout/Sidebar.vue';
import { asyncTaskPanel } from '../../views/taskPanelAsync';
import { flushPromises, i18n, setup } from './h';

// PLNRAPP-834: skeletons instead of an empty place while the task form and the left sidebar load
describe('PLNRAPP-834: скелетоны загрузки', () => {
  it('форма задачи: скелетон, пока задача не прочитана, затем форма или «не найдена»', async () => {
    await setup();
    const { default: TaskPanel } = await import('../TaskPanel.vue');
    const show = (taskKey: string) =>
      mount(
        defineComponent({
          render: () => h(TooltipProvider, null, () => h(TaskPanel, { taskKey, mode: 'panel' })),
        }),
        { global: { plugins: [i18n] } },
      );
    const p = show('PLN-1');
    expect(p.get('[data-testid=task-skeleton]').attributes('aria-label')).toBe('Загрузка задачи');
    await vi.waitFor(() => expect(p.find('article[aria-label="PLN-1"]').exists()).toBe(true));
    expect(p.find('[data-testid=task-skeleton]').exists()).toBe(false);

    const missing = show('PLN-999');
    expect(missing.find('[data-testid=task-skeleton]').exists()).toBe(true);
    await vi.waitFor(() => expect(missing.text()).toContain('Задача не найдена'));
    expect(missing.find('[data-testid=task-skeleton]').exists()).toBe(false);
  });

  it('форма задачи: скелетон, пока грузится чанк формы', async () => {
    let done!: () => void;
    const gate = new Promise<void>((r) => (done = r));
    const Lazy = asyncTaskPanel(async () => {
      await gate;
      // as a dynamic import: a module namespace (Vue takes default only from a Module)
      return Object.defineProperty(
        { default: { render: () => h('div', { 'data-testid': 'loaded' }) } },
        Symbol.toStringTag,
        { value: 'Module' },
      );
    })!;
    const a = mount(defineComponent({ render: () => h('section', [h(Lazy)]) }), {
      global: { plugins: [i18n] },
    });
    await flushPromises();
    expect(a.find('[data-testid=task-skeleton]').exists()).toBe(true);
    done();
    await vi.waitFor(() => expect(a.find('[data-testid=loaded]').exists()).toBe(true));
    expect(a.find('[data-testid=task-skeleton]').exists()).toBe(false);
  });

  it('левый сайдбар: скелетон, пока дерево не прочитано, затем пространства', async () => {
    await setup();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/:p(.*)*', component: { template: '<div />' } }],
    });
    const w = mount(Sidebar, { global: { plugins: [router, i18n] } });
    const sk = w.find('[data-testid=sidebar-skeleton]');
    expect(sk.exists()).toBe(true);
    expect(sk.attributes('aria-label')).toBe('Загрузка разделов');
    expect(w.text()).not.toContain('Пока пусто');
    await vi.waitFor(() => expect(w.findAll('[data-testid=nav-space]').length).toBeGreaterThan(0));
    expect(w.find('[data-testid=sidebar-skeleton]').exists()).toBe(false);
  });
});
