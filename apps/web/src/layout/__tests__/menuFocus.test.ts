import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { h } from 'vue';
import { ContextMenuContent } from 'reka-ui';
import Menu from '../../ui/Menu.vue';

// A menu action that opened an inline field (data-inline-edit) must not get focus pulled back to the trigger.
describe('Menu: close-auto-focus', () => {
  afterEach(() => (document.body.innerHTML = ''));
  const closeEvent = async (withField: boolean) => {
    const field = document.createElement('input');
    if (withField) field.setAttribute('data-inline-edit', '');
    document.body.append(field);
    const focus = vi.spyOn(field, 'focus');
    const w = mount(Menu, {
      attachTo: document.body,
      props: { context: true, items: [{ id: 'a', label: 'Act', onSelect: () => {} }] },
      slots: { default: () => h('span', { id: 'trg' }, 'T') },
    });
    document
      .getElementById('trg')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
    await new Promise((r) => setTimeout(r, 50));
    const e = new Event('focus', { cancelable: true });
    w.findComponent(ContextMenuContent).vm.$emit('closeAutoFocus', e);
    const focused = focus.mock.calls.length > 0;
    w.unmount();
    return { prevented: e.defaultPrevented, focused };
  };
  it('есть поле data-inline-edit: возврат на триггер отменён, фокус в поле', async () => {
    expect(await closeEvent(true)).toEqual({ prevented: true, focused: true });
  });
  it('иначе фокус возвращается на триггер, как раньше', async () => {
    expect(await closeEvent(false)).toEqual({ prevented: false, focused: false });
  });
});
