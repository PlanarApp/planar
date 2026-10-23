import { describe, expect, it } from 'vitest';
import { createI18n } from '../lite';

describe('i18n lite', () => {
  const i = createI18n({
    locale: 'en',
    fallbackLocale: 'ru',
    messages: { ru: { a: { b: 'ру {x}', only: "{'@'} ru" } }, en: { a: { b: 'en {x} {y}' } } },
  });
  it('подстановки, литералы, fallback, ключ, te', () => {
    expect(i.global.t('a.b', { x: 1 })).toBe('en 1 ');
    expect(i.global.t('a.only')).toBe('@ ru');
    expect(i.global.t('a.zz')).toBe('a.zz');
    expect(i.global.te('a.only')).toBe(false);
    i.global.locale.value = 'ru';
    expect(i.global.t('a.b', { x: 2 })).toBe('ру 2');
  });
});
