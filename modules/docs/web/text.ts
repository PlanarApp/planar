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
  archive: { ru: 'В архив', en: 'Archive' },
  expand: { ru: 'Развернуть', en: 'Expand' },
  link: { ru: 'Связать со страницей…', en: 'Link a page…' },
  unlink: { ru: 'Отвязать', en: 'Unlink' },
  createFromTask: { ru: 'Создать страницу', en: 'Create page' },
  noLinks: { ru: 'Нет связанных страниц', en: 'No linked pages' },
  mention: { ru: 'Упоминание', en: 'Mention' },
  uploadFailed: { ru: 'Не удалось загрузить изображение', en: 'Image upload failed' },
  h1: { ru: 'Заголовок 1', en: 'Heading 1' },
  h2: { ru: 'Заголовок 2', en: 'Heading 2' },
  h3: { ru: 'Заголовок 3', en: 'Heading 3' },
  bullet: { ru: 'Список', en: 'Bulleted list' },
  todo: { ru: 'Чек-лист', en: 'To-do list' },
  code: { ru: 'Код', en: 'Code block' },
  table: { ru: 'Таблица', en: 'Table' },
  image: { ru: 'Изображение', en: 'Image' },
} as const;
export type TextKey = keyof typeof S;
export type Texts = (k: TextKey, p?: Record<string, string>) => string;

/** Строки модуля — LocalizedText {ru, en}; язык берётся у web. */
export function useTexts(): Texts {
  const { locale } = i18n.global;
  return (k, p) =>
    S[k][locale.value === 'en' ? 'en' : 'ru'].replace(/\{(\w+)\}/g, (_, n) => p?.[n] ?? '');
}
export const label = (k: TextKey) => S[k];
