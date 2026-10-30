import 'fake-indexeddb/auto';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { uuidv7 } from '@planar/shared';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { ids, reset } from '../../tasks/__tests__/data';

const mutate = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../sync', async (orig) => ({ ...(await orig<object>()), mutate }));
const { formatFieldValue, setTaskField, FieldEditor } = await import('..');
const FieldsDialog = (await import('../FieldsDialog.vue')).default;

const def = (type: string, options: Record<string, unknown> = {}) =>
  ({
    id: uuidv7(),
    spaceId: ids.space,
    projectId: ids.project,
    name: 'F',
    type,
    options,
    rank: 'a0',
  }) as never;
const i18n = () => createI18n({ legacy: false, locale: 'ru', messages: { ru, en } });
const editor = (d: never, value?: unknown) =>
  mount(FieldEditor, {
    props: { def: d, value, spaceId: ids.space },
    global: { plugins: [i18n()] },
    attachTo: document.body,
  });
const type = async (w: ReturnType<typeof editor>, v: string) => {
  const input = w.get('input');
  await input.setValue(v); // setValue fires input and change
};
const emitted = (w: ReturnType<typeof editor>) => w.emitted('update:value') ?? [];

beforeEach(async () => {
  mutate.mockClear();
  await reset();
});

describe('fields-ui', () => {
  it('fields-ui: text эмитит значение, пусто — null', async () => {
    const w = editor(def('text'));
    await type(w, ' hi ');
    await type(w, '');
    expect(emitted(w)).toEqual([['hi'], [null]]);
  });
  it('fields-ui: number эмитит число, не-число не эмитит', async () => {
    const w = editor(def('number'));
    await type(w, '1,5');
    await type(w, 'abc');
    expect(emitted(w)).toEqual([[1.5]]);
  });
  it('fields-ui: money 12,5 даёт 1250', async () => {
    const w = editor(def('money', { currency: 'RUB' }));
    await type(w, '12,5');
    expect(emitted(w)).toEqual([[1250]]);
  });
  it('fields-ui: url принимает https и отклоняет javascript:', async () => {
    const w = editor(def('url'));
    await type(w, 'javascript:alert(1)');
    await type(w, 'https://example.com');
    expect(emitted(w)).toEqual([['https://example.com']]);
  });
  it('fields-ui: select очищается кнопкой', async () => {
    const w = editor(def('select', { choices: [{ id: 'c1', label: 'A' }] }), 'c1');
    await w.get('button:not([role=combobox])').trigger('click');
    expect(emitted(w)).toEqual([[null]]);
  });
  it('fields-ui: formatFieldValue для money и удалённого варианта select', () => {
    const ctx = { locale: 'en', users: [] };
    expect(formatFieldValue(def('money', { currency: 'USD' }), 1250, ctx)).toBe('$12.50');
    const sel = def('select', { choices: [{ id: 'c1', label: 'A' }] });
    expect(formatFieldValue(sel, 'c1', ctx)).toBe('A');
    expect(formatFieldValue(sel, 'gone', ctx)).toBe('');
    expect(formatFieldValue(sel, undefined, ctx)).toBe('');
  });
  it('fields-ui: setTaskField вызывает task.setField', async () => {
    await setTaskField('t', 'f', null);
    expect(mutate).toHaveBeenCalledWith('task.setField', {
      taskId: 't',
      fieldId: 'f',
      value: null,
    });
  });
  it('fields-ui: FieldsDialog создаёт поле с type и rank', async () => {
    const w = mount(FieldsDialog, {
      props: { open: true, projectId: ids.project },
      global: { plugins: [i18n()] },
      attachTo: document.body,
    });
    await vi.waitFor(() => expect(document.body.querySelector('form input')).not.toBeNull());
    const input = document.body.querySelector('form input') as HTMLInputElement;
    input.value = 'Бюджет';
    input.dispatchEvent(new Event('input'));
    await w.vm.$nextTick();
    (document.body.querySelector('[data-role=create]') as HTMLElement).click();
    await vi.waitFor(() =>
      expect(mutate).toHaveBeenCalledWith(
        'field.create',
        expect.objectContaining({
          projectId: ids.project,
          name: 'Бюджет',
          type: 'text',
          rank: expect.any(String),
        }),
      ),
    );
    w.unmount();
  });
});

describe('fields-fix', () => {
  it('fields-fix: Enter и change дают одну мутацию', async () => {
    const w = editor(def('text'));
    const input = w.get('input');
    await input.setValue('hi'); // input + change
    await input.trigger('keydown.enter');
    await input.trigger('change');
    expect(emitted(w)).toEqual([['hi']]);
  });
});
