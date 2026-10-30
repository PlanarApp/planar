import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { i18n } from '../../i18n';
import Editor from '../editor/Editor.vue';

vi.mock('../../command/search', () => ({
  useSearch: () => ({
    ready: ref(true),
    search: (q: string) => (q ? [{ id: 't1', ref: 'PLN-1', title: 'Вход' }] : []),
  }),
}));
const docSearch = vi.fn(async (q: string) =>
  q ? [{ id: 'd1', title: 'Регламент', to: '/m/docs/d1' }] : [],
);
vi.mock('../../modules/registry', () => ({
  useExtensions: () => ref([{ moduleId: 'docs', id: 'pages', search: docSearch }]),
}));

async function setup() {
  const w = mount(Editor, {
    props: { members: [], label: 'Сообщение', refs: true },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
  await flushPromises();
  const view = w.vm.editor!.view;
  // ввод с клавиатуры: правила ввода срабатывают через handleTextInput
  const type = (ch: string) => {
    const { from, to } = view.state.selection;
    const done = view.someProp('handleTextInput', (f) =>
      f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
    );
    if (!done) view.dispatch(view.state.tr.insertText(ch, from, to));
  };
  view.coordsAtPos = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
  return { w, type, json: () => JSON.stringify(w.vm.editor!.getJSON()) };
}

describe('редактор: @@ и @@@', () => {
  it('@@ открывает поиск задач, выбор вставляет ссылку /t/KEY без @@', async () => {
    const { w, type, json } = await setup();
    type('@');
    type('@');
    await flushPromises();
    await vi.waitFor(() => expect(w.find('[data-testid=ref-picker]').exists()).toBe(true));
    await w.find('[data-testid=ref-search]').setValue('вход');
    await w.find('[data-testid=ref-option]').trigger('mousedown');
    expect(w.find('[data-testid=ref-picker]').exists()).toBe(false);
    expect(json()).toContain('"href":"/t/PLN-1"');
    expect(json()).toContain('PLN-1 Вход');
    expect(json()).not.toContain('@');
    w.unmount();
  });

  it('третий @ в поиске переключает на документы', async () => {
    const { w, type, json } = await setup();
    type('@');
    type('@');
    await vi.waitFor(() => expect(w.find('[data-testid=ref-search]').exists()).toBe(true));
    await w.find('[data-testid=ref-search]').setValue('@');
    expect(w.find('[data-testid=ref-tab-docs]').attributes('aria-pressed')).toBe('true');
    await w.find('[data-testid=ref-search]').setValue('регл');
    await vi.waitFor(() => expect(w.findAll('[data-testid=ref-option]').length).toBe(1));
    await w.find('[data-testid=ref-option]').trigger('mousedown');
    expect(json()).toContain('"href":"/m/docs/d1"');
    w.unmount();
  });

  it('@@ внутри слова — текст; после пробела — диалог, пробел остаётся', async () => {
    const { w, type, json } = await setup();
    for (const ch of 'a@@') type(ch);
    await flushPromises();
    expect(w.find('[data-testid=ref-picker]').exists()).toBe(false);
    expect(json()).toContain('a@@');
    for (const ch of ' @@') type(ch);
    await vi.waitFor(() => expect(w.find('[data-testid=ref-picker]').exists()).toBe(true));
    expect(json()).toContain('a@@ ');
    w.unmount();
  });

  it('без refs @@ остаётся текстом', async () => {
    const w = mount(Editor, {
      props: { members: [], label: 'x' },
      global: { plugins: [i18n] },
    });
    await flushPromises();
    const view = w.vm.editor!.view;
    view.dispatch(view.state.tr.insertText('@@'));
    expect(w.find('[data-testid=ref-picker]').exists()).toBe(false);
    w.unmount();
  });
});
