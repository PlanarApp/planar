import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { i18n } from '../../i18n';
import Editor from '../editor/Editor.vue';

// happy-dom doesn't compute the layout: the content height and the observer are given by hand
let height = 0;
let notify = () => {};
vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(cb: () => void) {
      notify = cb;
    }
    observe() {
      notify();
    }
    disconnect() {}
  },
);
Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
  configurable: true,
  get: () => height,
});
afterEach(() => (height = 0));

const show = async (collapsible = true) => {
  const w = mount(Editor, {
    props: { members: [], label: 'Комментарий', editable: false, collapsible },
    global: { plugins: [i18n] },
  });
  await flushPromises();
  return w;
};

describe('PLNRAPP-93: длинный текст под «Развернуть»', () => {
  it('короткий — без кнопки; длинный — свёрнут, кнопка разворачивает и сворачивает', async () => {
    height = 150;
    const w = await show();
    expect(w.find('[data-testid=editor-expand]').exists()).toBe(false);
    height = 2000;
    notify();
    await flushPromises();
    const btn = w.get('[data-testid=editor-expand]');
    expect(w.find('.collapsed').exists()).toBe(true);
    await btn.trigger('click');
    expect(w.find('.collapsed').exists()).toBe(false);
    expect(btn.attributes('aria-expanded')).toBe('true');
    await btn.trigger('click');
    expect(w.find('.collapsed').exists()).toBe(true);
  });
  it('без collapsible длинный текст не сворачивается', async () => {
    height = 2000;
    const w = await show(false);
    expect(w.find('[data-testid=editor-expand]').exists()).toBe(false);
  });
});
