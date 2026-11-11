// The module's single point of contact with the web core: language.
import { i18n } from '@planar/web/modules';

const dict = {
  title: { ru: 'ИИ', en: 'AI' },
  intro: {
    ru: 'Подключение к ИИ-провайдеру. Действует ближайший уровень: проект, затем пространство, затем инстанс.',
    en: 'Connection to an AI provider. The nearest level applies: project, then space, then instance.',
  },
  own: { ru: 'Подключение этого уровня', en: 'Connection of this level' },
  none: { ru: 'Не задано', en: 'Not set' },
  inherited: { ru: 'Действует подключение уровня', en: 'In force: connection of level' },
  instance: { ru: 'инстанс', en: 'instance' },
  space: { ru: 'пространство', en: 'space' },
  project: { ru: 'проект', en: 'project' },
  provider: { ru: 'Провайдер', en: 'Provider' },
  baseUrl: { ru: 'Адрес API', en: 'API URL' },
  baseUrlHint: {
    ru: 'Обязателен для openai-compatible, у остальных — по умолчанию',
    en: 'Required for openai-compatible, optional for the others',
  },
  key: { ru: 'Ключ', en: 'Key' },
  keySet: { ru: 'Ключ сохранён и не показывается', en: 'The key is saved and never shown' },
  newKey: { ru: 'Новый ключ (пусто — оставить)', en: 'New key (empty — keep)' },
  model: { ru: 'Модель', en: 'Model' },
  priceIn: { ru: 'Цена входа, $ за 1 млн токенов', en: 'Input price, $ per 1M tokens' },
  priceOut: { ru: 'Цена выхода, $ за 1 млн токенов', en: 'Output price, $ per 1M tokens' },
  save: { ru: 'Проверить и сохранить', en: 'Check and save' },
  saving: { ru: 'Проверяю…', en: 'Checking…' },
  saved: { ru: 'Сохранено', en: 'Saved' },
  remove: { ru: 'Убрать подключение', en: 'Remove connection' },
  error: { ru: 'Ошибка', en: 'Error' },
} as const;
export type Key = keyof typeof dict;
export const tr = (k: Key): string => {
  const l = i18n.global.locale.value as 'ru' | 'en';
  return dict[k][l] ?? dict[k].ru;
};
