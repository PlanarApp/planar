import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import RichBody from './RichBody';

const doc = (href: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href } }] }],
    },
  ],
});

describe('RichBody: ссылки', () => {
  it('свой путь — внутренняя ссылка без новой вкладки; //host и javascript: — не ссылка', () => {
    const a = mount(RichBody, { props: { body: doc('/t/PLN-1'), me: '' } }).find('a');
    expect(a.attributes()).toMatchObject({ href: '/t/PLN-1', 'data-internal': '' });
    expect(a.attributes('target')).toBeUndefined();
    expect(
      mount(RichBody, { props: { body: doc('//evil.example'), me: '' } })
        .find('a')
        .exists(),
    ).toBe(false);
    expect(
      mount(RichBody, { props: { body: doc('/\\evil.example'), me: '' } })
        .find('a')
        .exists(),
    ).toBe(false);
    expect(
      mount(RichBody, { props: { body: doc('javascript:alert(1)'), me: '' } })
        .find('a')
        .exists(),
    ).toBe(false);
    expect(
      mount(RichBody, { props: { body: doc('https://x.example'), me: '' } })
        .find('a')
        .attributes('target'),
    ).toBe('_blank');
  });
});

describe('RichBody: форматирование ответа ИИ (PLNRAPP-334)', () => {
  const body = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Итог' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'строка' },
          { type: 'hardBreak' },
          { type: 'text', text: 'код', marks: [{ type: 'code' }] },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
          },
        ],
      },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: true },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'готово' }] }],
          },
        ],
      },
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableHeader',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }],
              },
            ],
          },
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }],
              },
            ],
          },
        ],
      },
      { type: 'horizontalRule' },
    ],
  };

  it('списки с маркерами, таблица, чек-лист, разделитель, перенос строки', () => {
    const w = mount(RichBody, { props: { body, me: '' } });
    expect(w.find('p.font-semibold').text()).toBe('Итог');
    expect(w.find('br').exists()).toBe(true);
    expect(w.find('code').classes()).toContain('font-mono');
    expect(w.find('ul.list-disc li').text()).toBe('a');
    const box = w.find('input[type="checkbox"]');
    expect((box.element as HTMLInputElement).checked).toBe(true);
    expect(box.attributes('disabled')).toBeDefined();
    expect(w.find('table th').text()).toBe('A');
    expect(w.find('table td').text()).toBe('1');
    expect(w.find('hr').exists()).toBe(true);
  });
});
