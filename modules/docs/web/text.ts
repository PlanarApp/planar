import { i18n } from '@planar/web/modules';

const S = {
  docs: { ru: 'Документы', en: 'Documents' },
  back: { ru: 'Назад', en: 'Back' },
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
  move: { ru: 'Перенести в проект', en: 'Move to project' },
  noProject: { ru: 'Без проекта', en: 'No project' },
  expand: { ru: 'Развернуть', en: 'Expand' },
  link: { ru: 'Связать со страницей…', en: 'Link a page…' },
  unlink: { ru: 'Отвязать', en: 'Unlink' },
  createFromTask: { ru: 'Создать страницу', en: 'Create page' },
  noLinks: { ru: 'Нет связанных страниц', en: 'No linked pages' },
  unsynced: { ru: 'Не синхронизируется', en: 'Not syncing' },
  retry: { ru: 'Повторить', en: 'Retry' },
  mention: { ru: 'Упоминание', en: 'Mention' },
  uploadFailed: { ru: 'Не удалось загрузить изображение', en: 'Image upload failed' },
  history: { ru: 'История версий', en: 'Version history' },
  noVersions: { ru: 'Версий пока нет', en: 'No versions yet' },
  versionsFailed: { ru: 'Не удалось загрузить историю', en: 'Failed to load the history' },
  restore: { ru: 'Восстановить эту версию', en: 'Restore this version' },
  restoreFailed: { ru: 'Не удалось восстановить версию', en: 'Failed to restore the version' },
  restoreForbidden: { ru: 'Нет прав на изменение страницы', en: 'No permission to edit the page' },
  srcEditor: { ru: 'редактор', en: 'editor' },
  srcApi: { ru: 'API', en: 'API' },
  srcRestore: { ru: 'восстановление', en: 'restore' },
  comments: { ru: 'Комментарии', en: 'Comments' },
  comment: { ru: 'Комментарий', en: 'Comment' },
  commentPlaceholder: { ru: 'Написать комментарий…', en: 'Write a comment…' },
  replyPlaceholder: { ru: 'Ответить…', en: 'Reply…' },
  send: { ru: 'Отправить', en: 'Send' },
  reply: { ru: 'Ответить', en: 'Reply' },
  edit: { ru: 'Изменить', en: 'Edit' },
  edited: { ru: 'изменён', en: 'edited' },
  delete: { ru: 'Удалить', en: 'Delete' },
  save: { ru: 'Сохранить', en: 'Save' },
  cancel: { ru: 'Отмена', en: 'Cancel' },
  assign: { ru: 'Назначить комментарий', en: 'Assign the comment' },
  unassign: { ru: 'Снять назначение', en: 'Unassign' },
  resolve: { ru: 'Завершить', en: 'Resolve' },
  resolved: { ru: 'Завершено', en: 'Resolved' },
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
