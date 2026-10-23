import { ref } from 'vue';

const KEY = 'planar.snooze';
const load = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
};
// shortcut: «отложить» хранится на устройстве, между устройствами не синхронизируется; нужна сущность в C-schema
export const snoozed = ref<Record<string, string>>(load());

export function snooze(id: string, until: Date): void {
  snoozed.value = { ...snoozed.value, [id]: until.toISOString() };
  try {
    localStorage.setItem(KEY, JSON.stringify(snoozed.value));
  } catch {
    /* хранилище недоступно: отложено до перезагрузки */
  }
}

/** Скрыто ли уведомление в момент now (читает реактивный snoozed). */
export const isSnoozed = (id: string, now = new Date()): boolean => {
  const u = snoozed.value[id];
  return !!u && new Date(u) > now;
};

export type SnoozeOption = '3h' | 'tomorrow' | 'week';
export function snoozeUntil(o: SnoozeOption, now = new Date()): Date {
  const d = new Date(now);
  if (o === '3h') d.setHours(d.getHours() + 3);
  else if (o === 'week') d.setDate(d.getDate() + 7);
  else {
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
  }
  return d;
}
