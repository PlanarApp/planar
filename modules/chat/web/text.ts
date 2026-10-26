import { i18n } from '@planar/web/modules';

const S = {
  chat: { ru: 'Чат', en: 'Chat' },
  settings: { ru: 'Настроить канал', en: 'Channel settings' },
  channelMenu: { ru: 'Действия канала', en: 'Channel actions' },
  topic: { ru: 'Тема', en: 'Topic' },
  archive: { ru: 'В архив', en: 'Archive' },
  unarchive: { ru: 'Вернуть из архива', en: 'Unarchive' },
  deleteChannel: { ru: 'Удалить канал', en: 'Delete channel' },
  deleteChannelTitle: { ru: 'Удалить канал «{name}»?', en: 'Delete channel “{name}”?' },
  deleteChannelHint: {
    ru: 'Сообщения и реакции канала удалятся у всех, вернуть нельзя',
    en: 'Messages and reactions will be deleted for everyone; this cannot be undone',
  },
  dms: { ru: 'Личные', en: 'Direct' },
  newChannel: { ru: 'Новый канал', en: 'New channel' },
  channelName: { ru: 'Название канала', en: 'Channel name' },
  newDm: { ru: 'Новый диалог', en: 'New conversation' },
  create: { ru: 'Создать', en: 'Create' },
  empty: { ru: 'Выберите канал или диалог', en: 'Pick a channel or conversation' },
  noMessages: { ru: 'Сообщений пока нет', en: 'No messages yet' },
  msgNotFound: { ru: 'Сообщение не найдено', en: 'Message not found' },
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
  deleteConfirm: { ru: 'Удалить сообщение?', en: 'Delete message?' },
  deleted: { ru: 'Сообщение удалено', en: 'Message deleted' },
  edited: { ru: 'изменено', en: 'edited' },
  typing: { ru: '{names} печатает…', en: '{names} is typing…' },
  typingMany: { ru: '{names} печатают…', en: '{names} are typing…' },
  sendFailed: { ru: 'Не удалось отправить: {m}', en: 'Could not send: {m}' },
  uploadFailed: { ru: 'Не удалось загрузить файл', en: 'File upload failed' },
  tooLarge: { ru: 'Файл слишком большой', en: 'File is too large' },
  archived: { ru: 'Канал в архиве', en: 'Channel is archived' },
  unread: { ru: 'Непрочитанных: {n}', en: '{n} unread' },
  unreadOnly: { ru: 'Непрочитанные', en: 'Unread' },
  allChats: { ru: 'Все', en: 'All' },
  noUnread: { ru: 'Нет непрочитанных', en: 'Nothing unread' },
  newMessages: { ru: 'Новые', en: 'New' },
  unreadMark: { ru: 'Есть непрочитанные', en: 'Unread' },
  members: { ru: 'Участники', en: 'Members' },
  addMember: { ru: 'Добавить', en: 'Add' },
  removeMember: { ru: 'Убрать {name}', en: 'Remove {name}' },
  write: { ru: 'Написать', en: 'Write' },
  writeSearch: { ru: 'Чат или сотрудник', en: 'Chat or person' },
  people: { ru: 'Сотрудники', en: 'People' },
  chats: { ru: 'Чаты', en: 'Chats' },
  nothingFound: { ru: 'Ничего не найдено', en: 'Nothing found' },
  noChannels: { ru: 'Нет каналов', en: 'No channels' },
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
