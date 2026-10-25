import { db, i18n, mutate, useQuery } from '@planar/web/modules';

export { mutate };

const dict = {
  title: { ru: 'Почта (SMTP)', en: 'Email (SMTP)' },
  host: { ru: 'Хост', en: 'Host' },
  port: { ru: 'Порт', en: 'Port' },
  secure: {
    ru: 'TLS сразу (иначе STARTTLS, если сервер предлагает)',
    en: 'TLS immediately (else STARTTLS if offered)',
  },
  username: { ru: 'Логин', en: 'Username' },
  password: { ru: 'Пароль', en: 'Password' },
  passwordSet: {
    ru: 'Пароль задан — введите новый, чтобы заменить',
    en: 'Password set — enter a new one to replace',
  },
  passwordDel: { ru: 'Удалить пароль', en: 'Remove password' },
  from: { ru: 'Отправитель (addr или Имя <addr>)', en: 'From (addr or Name <addr>)' },
  save: { ru: 'Сохранить', en: 'Save' },
  testTo: { ru: 'Кому отправить тест', en: 'Send test to' },
  test: { ru: 'Отправить тестовое письмо', en: 'Send test email' },
  sent: { ru: 'Отправлено', en: 'Sent' },
  prefs: { ru: 'Email', en: 'Email' },
  notify: {
    ru: 'Письма об упоминаниях и назначениях (через 10 минут, если не прочитано)',
    en: 'Emails for mentions and assignments (after 10 min if unread)',
  },
  digest: { ru: 'Ежедневный дайджест', en: 'Daily digest' },
} as const;
export type Key = keyof typeof dict;
export const tr = (k: Key): string => {
  const l = i18n.global.locale.value as 'ru' | 'en';
  return dict[k][l] ?? dict[k].ru;
};

export interface Prefs {
  notify: boolean;
  digest: boolean;
}
export const usePrefs = (userId: () => string | undefined) =>
  useQuery(async (): Promise<Prefs> => {
    const r = (await db.table('emailPrefs').get(userId() ?? '')) as Partial<Prefs> | undefined;
    return { notify: r?.notify ?? true, digest: r?.digest ?? false };
  });
