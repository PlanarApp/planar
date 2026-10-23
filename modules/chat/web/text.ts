import { i18n } from '@planar/web/modules';

const S = {
  chat: { ru: 'Чат', en: 'Chat' },
  dms: { ru: 'Личные', en: 'Direct' },
  newChannel: { ru: 'Новый канал', en: 'New channel' },
  channelName: { ru: 'Название канала', en: 'Channel name' },
  newDm: { ru: 'Новый диалог', en: 'New conversation' },
  create: { ru: 'Создать', en: 'Create' },
  empty: { ru: 'Выберите канал или диалог', en: 'Pick a channel or conversation' },
  noMessages: { ru: 'Сообщений пока нет', en: 'No messages yet' },
  loading: { ru: 'Загрузка…', en: 'Loading…' },
  back: { ru: 'Назад', en: 'Back' },
  message: { ru: 'Сообщение', en: 'Message' },
  placeholder: { ru: 'Напишите сообщение…', en: 'Write a message…' },
  send: { ru: 'Отправить', en: 'Send' },
  attach: { ru: 'Прикрепить файл', en: 'Attach a file' },
  remove: { ru: 'Убрать', en: 'Remove' },
  reply: { ru: 'Ответить', en: 'Reply' },
  react: { ru: 'Реакция', en: 'React' },
  replies: { ru: 'Ответов: {n}', en: '{n} replies' },
  thread: { ru: 'Тред', en: 'Thread' },
  close: { ru: 'Закрыть', en: 'Close' },
  edit: { ru: 'Изменить', en: 'Edit' },
  save: { ru: 'Сохранить', en: 'Save' },
  cancel: { ru: 'Отмена', en: 'Cancel' },
  delete: { ru: 'Удалить', en: 'Delete' },
  deleted: { ru: 'Сообщение удалено', en: 'Message deleted' },
  edited: { ru: 'изменено', en: 'edited' },
  typing: { ru: '{names} печатает…', en: '{names} is typing…' },
  typingMany: { ru: '{names} печатают…', en: '{names} are typing…' },
  sendFailed: { ru: 'Не удалось отправить: {m}', en: 'Could not send: {m}' },
  uploadFailed: { ru: 'Не удалось загрузить файл', en: 'File upload failed' },
  tooLarge: { ru: 'Файл слишком большой', en: 'File is too large' },
  archived: { ru: 'Канал в архиве', en: 'Channel is archived' },
  unread: { ru: 'Непрочитанных: {n}', en: '{n} unread' },
  unknown: { ru: 'Неизвестный', en: 'Unknown' },
} as const;
export type TextKey = keyof typeof S;
export type Texts = (k: TextKey, p?: Record<string, string | number>) => string;

/** Строки модуля — LocalizedText {ru, en}; язык берётся у web. */
export function useTexts(): Texts {
  const { locale } = i18n.global;
  return (k, p) =>
    S[k][locale.value === 'en' ? 'en' : 'ru'].replace(/\{(\w+)\}/g, (_, n) => String(p?.[n] ?? ''));
}
export const label = (k: TextKey) => S[k];
