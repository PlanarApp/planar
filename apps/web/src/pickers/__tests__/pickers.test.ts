import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { createI18n } from 'vue-i18n';
import en from '../../i18n/en';
import ru from '../../i18n/ru';
import { Avatar } from '../../ui';

const docSearch = vi.fn(async (q: string) =>
  q ? [{ id: 'd1', title: 'Регламент', path: 'Wiki / Процессы', to: '/m/docs/d1' }] : [],
);
vi.mock('../../modules/registry', () => ({
  useExtensions: () => ref([{ moduleId: 'docs', id: 'pages', search: docSearch }]),
}));
const { DocPicker, SuggestList, TaskPicker, UserPicker, avatarSrc } = await import('../index');

const i18n = createI18n({
  legacy: false,
  locale: 'ru',
  fallbackLocale: 'ru',
  messages: { ru, en },
});
const opts = { global: { plugins: [i18n] }, attachTo: document.body };
const users = [
  { id: 'u1', name: 'Анна Иванова', avatarFile: 'f1' },
  { id: 'u2', name: 'Борис' },
];
afterEach(() => (document.body.innerHTML = ''));

describe('PLNRAPP-827 общие компоненты выбора', () => {
  it('UserPicker: аватары в кнопке и в списке, «никто» отдаёт null', async () => {
    const w = mount(UserPicker, {
      ...opts,
      props: { users, selected: ['u1'], title: 'Исполнитель', none: 'Никто' },
    });
    // the chosen person's avatar is on the button, with the picture
    expect(w.findComponent(Avatar).props()).toMatchObject({
      name: 'Анна Иванова',
      src: '/files/f1/preview?w=256',
    });
    await w.find('button').trigger('click');
    await flushPromises();
    const items = [...document.body.querySelectorAll<HTMLElement>('[role=option]')];
    expect(items.map((i) => i.querySelector('.flex-1')?.textContent)).toEqual([
      'Никто',
      'Анна Иванова',
      'Борис',
    ]);
    // every person's row has an avatar; without a picture — the initials
    expect(items[1]!.querySelector('[title="Анна Иванова"]')).not.toBeNull();
    expect(items[2]!.querySelector('[title="Борис"]')?.textContent?.trim()).toBe('Б');
    items[2]!.click();
    items[0]!.click();
    expect(w.emitted('pick')).toEqual([['u2'], [null]]);
    w.unmount();
  });

  it('UserPicker: пункт «Создать нового» (импорт) — событие create и подпись на кнопке', async () => {
    const w = mount(UserPicker, {
      ...opts,
      props: { users, selected: [], title: 'G L', none: 'Нет', create: 'Создать нового' },
    });
    expect(w.find('button').text()).toContain('Нет');
    await w.find('button').trigger('click');
    await flushPromises();
    const items = [...document.body.querySelectorAll<HTMLElement>('[role=option]')];
    expect(items.map((i) => i.querySelector('.flex-1')?.textContent)).toEqual([
      'Нет',
      'Создать нового',
      'Анна Иванова',
      'Борис',
    ]);
    items[1]!.click();
    expect(w.emitted('create')).toHaveLength(1);
    expect(w.emitted('pick')).toBeUndefined();
    await w.setProps({ creating: true });
    expect(w.find('button').text()).toContain('Создать нового');
    w.unmount();
  });

  it('SuggestList: у людей (@) аватар, как в UserPicker; у команд — нет', async () => {
    const w = mount(SuggestList, {
      ...opts,
      props: {
        label: 'Упоминание',
        index: 1,
        items: [
          { key: 'u1', label: 'Анна Иванова', user: users[0] },
          { key: 'u2', label: 'Борис', user: users[1] },
          { key: 'h1', label: 'Заголовок' },
        ],
      },
    });
    const rows = w.findAll('[role=option]');
    expect(rows.map((r) => r.attributes('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(rows[0]!.findComponent(Avatar).props()).toMatchObject({
      name: 'Анна Иванова',
      src: '/files/f1/preview?w=256',
    });
    expect(rows[1]!.findComponent(Avatar).props('src')).toBeNull();
    expect(rows[2]!.findComponent(Avatar).exists()).toBe(false);
    await rows[2]!.trigger('mousedown');
    expect(w.emitted('pick')).toEqual([[2]]);
    w.unmount();
  });

  it('avatarSrc: без файла — null', () => {
    expect(avatarSrc({ avatarFile: null })).toBeNull();
    expect(avatarSrc(undefined)).toBeNull();
  });

  it('TaskPicker: ключ, название, путь; ↓ Enter выбирает', async () => {
    const tasks = [
      { id: 't1', key: 'PLN-1', title: 'Вход' },
      { id: 't2', key: 'PLN-2', title: 'Выход', path: 'PLN-1 Вход' },
    ];
    const w = mount(TaskPicker, { ...opts, props: { tasks, query: 'в' } });
    expect(w.findAll('[role=option]').map((o) => o.text())).toEqual([
      'PLN-1 Вход',
      'PLN-1 ВходPLN-2 Выход',
    ]);
    expect(w.find('[data-testid=pick-path]').text()).toBe('PLN-1 Вход');
    const input = w.find('input');
    await input.trigger('keydown', { key: 'ArrowDown' });
    await input.trigger('keydown', { key: 'Enter' });
    await w.findAll('[role=option]')[0]!.trigger('click');
    expect(w.emitted('pick')!.map(([x]) => (x as { id: string }).id)).toEqual(['t2', 't1']);
    w.unmount();
  });

  it('DocPicker: поиск через модуль документов, у страницы путь', async () => {
    const w = mount(DocPicker, { ...opts, props: { query: '' } });
    expect(w.findAll('[role=option]')).toHaveLength(0);
    await w.find('input').setValue('регл');
    await flushPromises();
    expect(docSearch).toHaveBeenLastCalledWith('регл', 20);
    expect(w.find('[data-testid=pick-path]').text()).toBe('Wiki / Процессы');
    await w.find('[role=option]').trigger('click');
    expect((w.emitted('pick')![0]![0] as { to: string }).to).toBe('/m/docs/d1');
    w.unmount();
  });
});
