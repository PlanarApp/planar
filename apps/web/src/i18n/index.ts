import { createI18n } from 'vue-i18n';
import en from './en';
import ru from './ru';

export type Locale = 'ru' | 'en';
const KEY = 'planar.locale';

const initial = (): Locale => {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'ru' || v === 'en') return v;
  } catch {
    /* хранилище недоступно */
  }
  return navigator.language?.startsWith('ru') ? 'ru' : 'en';
};

export const i18n = createI18n({
  legacy: false,
  locale: initial(),
  fallbackLocale: 'ru',
  messages: { ru, en },
});

export function setLocale(l: Locale): void {
  i18n.global.locale.value = l;
  document.documentElement.lang = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* хранилище недоступно */
  }
}
