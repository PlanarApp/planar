// PLNRAPP-833: mentions in the document editor — @ people with avatars, @@ a task link, @@@ a document link
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import type { Editor } from '@tiptap/vue-3';
import { i18n } from '@planar/web/modules';
import DocEditor from './DocEditor.vue';

const push = vi.fn();
vi.mock('vue-router', async (orig) => ({
  ...(await orig<object>()),
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  useRoute: () => ({ params: {}, query: {} }),
}));
vi.mock('../../../apps/web/src/command/search', () => ({
  useSearch: () => ({
    ready: ref(true),
    search: (q: string) => (q ? [{ id: 't1', ref: 'PLN-1', title: 'Вход' }] : []),
  }),
}));
vi.mock('../../../apps/web/src/modules/registry', async (orig) => ({
  ...(await orig<object>()),
  useExtensions: () =>
    ref([
      {
        moduleId: 'docs',
        id: 'pages',
        search: async (q: string) => (q ? [{ id: 'd1', title: 'Регламент', to: '/m/docs/d1' }] : []),
      },
    ]),
}));
// no server: the editor without Yjs, access is granted at once
vi.mock('@planar/editor/collab', () => ({
  openCollab: () => ({
    extensions: [],
    readOnly: () => false,
    onAuthenticated: (cb: () => void) => cb(),
    onDenied: () => {},
    destroy: () => {},
    retry: () => {},
  }),
}));

async function setup() {
  const w = mount(DocEditor, {
    props: { name: 'docs:p1', members: [{ id: 'u1', name: 'Анна' }] },
    global: { plugins: [i18n], stubs: { Tooltip: { template: '<slot />' } } },
    attachTo: document.body,
  });
  const vm = w.vm as unknown as { editor: Editor | null };
  await vi.waitFor(() => expect(vm.editor).toBeTruthy());
  const view = vm.editor!.view;
  view.coordsAtPos = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
  // keyboard input: input rules and suggestions react to handleTextInput
  const type = async (s: string) => {
    for (const ch of s) {
      const { from, to } = view.state.selection;
      const done = view.someProp('handleTextInput', (f) =>
        f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)),
      );
      if (!done) view.dispatch(view.state.tr.insertText(ch, from, to));
    }
    await flushPromises();
  };
  return { w, type, json: () => JSON.stringify(vm.editor!.getJSON()) };
}

describe('docs: упоминания в редакторе документа (PLNRAPP-833)', () => {
  it('«@» открывает список пользователей с аватарами', async () => {
    const { w, type } = await setup();
    await type('@');
    await vi.waitFor(() => expect(w.find('[data-testid=suggest-user]').exists()).toBe(true));
    const row = w.find('[data-testid=suggest-user]');
    expect(row.text()).toContain('Анна');
    expect(row.find('svg, img, span').exists()).toBe(true);
    w.unmount();
  });

  it('«@@» вставляет ссылку на задачу', async () => {
    const { w, type, json } = await setup();
    await type('@@');
    await vi.waitFor(() => expect(w.find('[data-testid=ref-picker]').exists()).toBe(true));
    await w.find('[data-testid=ref-search]').setValue('вход');
    await w.find('[data-testid=ref-option]').trigger('click');
    expect(w.find('[data-testid=ref-picker]').exists()).toBe(false);
    expect(json()).toContain('"href":"/t/PLN-1"');
    expect(json()).toContain('PLN-1 Вход');
    expect(json()).not.toContain('@');
    w.unmount();
  });

  it('«@@@» вставляет ссылку на документ', async () => {
    const { w, type, json } = await setup();
    await type('@@');
    await vi.waitFor(() => expect(w.find('[data-testid=ref-search]').exists()).toBe(true));
    // the third @ goes into the focused search field of the dialog
    await w.find('[data-testid=ref-search]').setValue('@');
    expect(w.find('[data-testid=ref-tab-docs]').attributes('aria-pressed')).toBe('true');
    await w.find('[data-testid=ref-search]').setValue('регл');
    await vi.waitFor(() => expect(w.findAll('[data-testid=ref-option]').length).toBe(1));
    await w.find('[data-testid=ref-option]').trigger('click');
    expect(json()).toContain('"href":"/m/docs/d1"');
    expect(json()).toContain('Регламент');
    w.unmount();
  });

  it('клик по ссылке @@/@@@ открывает её в приложении; с Ctrl — по-браузерному', async () => {
    const { w, type } = await setup();
    await type('@@');
    await vi.waitFor(() => expect(w.find('[data-testid=ref-search]').exists()).toBe(true));
    await w.find('[data-testid=ref-search]').setValue('вход');
    await w.find('[data-testid=ref-option]').trigger('click');
    const a = w.find('.ProseMirror a[href="/t/PLN-1"]');
    const pos = (w.vm as unknown as { editor: Editor }).editor.view.posAtDOM(a.element, 0);
    const click = (o: MouseEventInit) => {
      const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...o });
      Object.defineProperty(e, 'target', { value: a.element });
      const view = (w.vm as unknown as { editor: Editor }).editor.view;
      return view.someProp('handleClick', (f) => f(view, pos, e)) ?? false;
    };
    // with Ctrl the Link extension opens a new tab — jsdom would fetch the page
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    push.mockClear();
    click({ ctrlKey: true });
    expect(push).not.toHaveBeenCalled();
    expect(click({})).toBe(true);
    expect(push).toHaveBeenCalledWith('/t/PLN-1');
    open.mockRestore();
    w.unmount();
  });
});
