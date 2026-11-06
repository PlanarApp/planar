import { i18n } from '@planar/web/modules';

const S = {
  docs: { ru: 'Документы', en: 'Documents' },
  newPage: { ru: 'Новая страница', en: 'New page' },
  untitled: { ru: 'Без названия', en: 'Untitled' },
  title: { ru: 'Название', en: 'Title' },
  body: { ru: 'Текст страницы', en: 'Page body' },
  placeholder: { ru: 'Печатайте «/» для команд', en: "Type '/' for commands" },
  notFound: { ru: 'Страница не найдена', en: 'Page not found' },
  pick: { ru: 'Выберите страницу в боковой панели', en: 'Pick a page in the sidebar' },
  pickHere: { ru: 'Выберите страницу слева или создайте новую «+»', en: 'Pick a page on the left or add one with “+”' },
  noPages: { ru: 'Страниц пока нет', en: 'No pages yet' },
  archive: { ru: 'В архив', en: 'Archive' },
  archiveTitle: { ru: 'Отправить страницу в архив?', en: 'Archive this page?' },
  actions: { ru: 'Действия страницы', en: 'Page actions' },
  expand: { ru: 'Развернуть', en: 'Expand' },
  link: { ru: 'Связать со страницей…', en: 'Link a page…' },
  unlink: { ru: 'Отвязать', en: 'Unlink' },
  createFromTask: { ru: 'Создать страницу', en: 'Create page' },
  noLinks: { ru: 'Нет связанных страниц', en: 'No linked pages' },
  unsynced: { ru: 'Не синхронизируется', en: 'Not syncing' },
  retry: { ru: 'Повторить', en: 'Retry' },
  mention: { ru: 'Упоминание', en: 'Mention' },
  uploadFailed: { ru: 'Не удалось загрузить изображение', en: 'Image upload failed' },
} as const;
export type TextKey = keyof typeof S;
export type Texts = (k: TextKey, p?: Record<string, string>) => string;

/** Module strings — LocalizedText {ru, en}; the language is taken from web. */
export function useTexts(): Texts {
  const { locale } = i18n.global;
  return (k, p) =>
    S[k][locale.value === 'en' ? 'en' : 'ru'].replace(/\{(\w+)\}/g, (_, n) => p?.[n] ?? '');
}
export const label = (k: TextKey) => S[k];
