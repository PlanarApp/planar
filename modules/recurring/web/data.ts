import { db, i18n, mutate, newId, useQuery } from '@planar/web/modules';
import type { Rule } from '../shared/index.js';

export { mutate, newId };
export const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export const useRule = (taskId: () => string) =>
  useQuery(
    async () =>
      (await db.table('recurringRules').where('taskId').equals(taskId()).first()) as
        Rule | undefined,
  );

const dict = {
  title: { ru: 'Повтор', en: 'Repeat' },
  kind: { ru: 'Режим', en: 'Mode' },
  interval: { ru: 'Через интервал', en: 'Every interval' },
  weekdays: { ru: 'По дням недели', en: 'On weekdays' },
  after_done: { ru: 'После завершения', en: 'After completion' },
  every: { ru: 'Каждые', en: 'Every' },
  day: { ru: 'дн.', en: 'days' },
  week: { ru: 'нед.', en: 'weeks' },
  month: { ru: 'мес.', en: 'months' },
  tz: { ru: 'Часовой пояс', en: 'Time zone' },
  next: { ru: 'Следующая дата', en: 'Next date' },
  save: { ru: 'Сохранить', en: 'Save' },
  remove: { ru: 'Убрать повтор', en: 'Remove repeat' },
  badTz: { ru: 'Неверный часовой пояс', en: 'Invalid time zone' },
  d0: { ru: 'Вс', en: 'Su' },
  d1: { ru: 'Пн', en: 'Mo' },
  d2: { ru: 'Вт', en: 'Tu' },
  d3: { ru: 'Ср', en: 'We' },
  d4: { ru: 'Чт', en: 'Th' },
  d5: { ru: 'Пт', en: 'Fr' },
  d6: { ru: 'Сб', en: 'Sa' },
} as const;
export type Key = keyof typeof dict;
export const tr = (k: Key): string => {
  const l = i18n.global.locale.value as 'ru' | 'en';
  return dict[k][l] ?? dict[k].ru;
};
