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
