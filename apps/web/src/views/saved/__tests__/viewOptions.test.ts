// the «View» menu shows only the settings the current layout applies
import { DOMWrapper, flushPromises, mount } from '@vue/test-utils';
import { h } from 'vue';
import { afterEach, describe, expect, it } from 'vitest';
import { TooltipProvider } from 'reka-ui';
import { createI18n } from 'vue-i18n';
import en from '../../../i18n/en';
import ru from '../../../i18n/ru';
import { optionsFrom } from '../../options';
import ViewOptionsPopover from '../ViewOptionsPopover.vue';

let w: ReturnType<typeof mount> | undefined;
afterEach(() => {
  w?.unmount();
  w = undefined;
});

async function menu(layout: string) {
  const options = { ...optionsFrom(undefined), showSubtasks: true };
  w = mount(() => h(TooltipProvider, null, () => h(ViewOptionsPopover, { options, layout })), {
    attachTo: document.body,
    global: { plugins: [createI18n({ legacy: false, locale: 'ru', messages: { ru, en } })] },
  });
  await w.get('[data-testid=view-toggle]').trigger('click');
  await flushPromises();
  const body = new DOMWrapper(document.body).get('[data-testid=view-options]');
  return {
    // the selects carry their labels as attributes
    text: body.html(),
    has: (testid: string) => body.find(`[data-testid=${testid}]`).exists(),
    field: (f: string) => body.find(`[data-field=${f}]`).exists(),
  };
}

describe('меню «Вид» по видам', () => {
  it('Список — все настройки', async () => {
    const m = await menu('list');
    expect(m.text).toContain('Группировка');
    expect(m.text).toContain('Сортировка');
    for (const id of [
      'subtasks-fold',
      'show-empty',
      'hide-empty-groups',
      'wrap-titles',
      'show-key',
    ])
      expect(m.has(id), id).toBe(true);
    expect(m.field('status')).toBe(true);
  });
  it('Мой день — без группировки и сортировки', async () => {
    const m = await menu('day');
    expect(m.text).not.toContain('Группировка');
    expect(m.text).not.toContain('Сортировка');
    expect(m.has('show-key')).toBe(true);
  });
  it('Доска — без сворачивания подзадач', async () => {
    const m = await menu('board');
    expect(m.text).toContain('Сортировка');
    expect(m.has('subtasks-fold')).toBe(false);
    expect(m.has('show-key')).toBe(true);
    expect(m.field('status')).toBe(true);
  });
  it('Таблица — без группировки, пустых полей, ключа и названий меток', async () => {
    const m = await menu('table');
    expect(m.text).not.toContain('Группировка');
    expect(m.text).toContain('Сортировка');
    for (const id of ['show-empty', 'hide-empty-groups', 'show-key', 'show-label-names'])
      expect(m.has(id), id).toBe(false);
    expect(m.has('wrap-titles')).toBe(true);
  });
  it('Календарь — только подзадачи; вид модуля — ничего', async () => {
    const m = await menu('calendar');
    expect(m.text).toContain('Подзадачи');
    expect(m.text).not.toContain('Сортировка');
    expect(m.has('wrap-titles')).toBe(false);
    expect(m.field('status')).toBe(false);
    w!.unmount();
    w = undefined;
    const t = await menu('timeline');
    expect(t.text).not.toContain('Подзадачи');
  });
});
