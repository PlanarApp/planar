import { describe, expect, it } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { i18n } from '../../i18n';
import Editor from '../editor/Editor.vue';

const doc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'привет ' },
        { type: 'mention', attrs: { id: 'u1', label: 'Bob' } },
        { type: 'text', text: ' <b>не тег</b>', marks: [{ type: 'bold' }] },
      ],
    },
  ],
};

const show = async (props: Record<string, unknown>) => {
  const w = mount(Editor, {
    props: { members: [], label: 'Комментарий', editable: false, lazy: true, ...props },
    global: { plugins: [i18n] },
  });
  await flushPromises();
  return w;
};

describe('PLNRAPP-249: комментарий в ленте — статичный HTML до наведения', () => {
  it('без редактора: та же разметка схемы, текст экранирован; наведение создаёт редактор', async () => {
    const w = await show({ modelValue: doc });
    const view = w.get('.ProseMirror');
    expect(view.attributes('contenteditable')).toBeUndefined();
    expect(view.attributes('aria-label')).toBe('Комментарий');
    expect(view.find('.mention').text()).toBe('@Bob');
    expect(view.find('strong').text()).toBe('<b>не тег</b>');
    expect(w.vm.editor).toBeNull();

    await w.get('.task-editor > div').trigger('pointerenter');
    await flushPromises();
    expect(w.vm.editor).not.toBeNull();
    expect(w.get('.ProseMirror').attributes('contenteditable')).toBe('false');
    expect(w.get('.ProseMirror .mention').text()).toBe('@Bob');
  });

  it('документ вне схемы — сразу редактор; без lazy — редактор как раньше', async () => {
    const bad = await show({ modelValue: { type: 'doc', content: [{ type: 'нет-такого' }] } });
    expect(bad.vm.editor).not.toBeNull();
    const eager = await show({ modelValue: doc, lazy: false });
    expect(eager.vm.editor).not.toBeNull();
  });
});
