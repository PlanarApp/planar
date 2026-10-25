// Единственная точка контакта модуля с ядром web: реплика, API, роутер, язык.
import { computed } from 'vue';
import { api, db, i18n, useQuery, useRouter, useSession } from '@planar/web/modules';
import type { BridgeDeps } from './bridge.js';
import type { Plugin } from '../shared/index.js';

export { api, useRouter, useSession };

export const usePlugins = () => {
  const r = useQuery(() => db.table('pluginsPlugins').toArray() as Promise<Plugin[]>);
  return computed(() => (r.value ?? []).filter((p) => p.enabled));
};
export const allPlugins = () =>
  useQuery(() => db.table('pluginsPlugins').toArray() as Promise<Plugin[]>);

export const locale = (): 'ru' | 'en' => (i18n.global.locale.value === 'en' ? 'en' : 'ru');
export const theme = (): 'light' | 'dark' =>
  document.documentElement.classList.contains('dark') ? 'dark' : 'light';

export const taskContext = async (taskId: string) => {
  const t = (await db.table('tasks').get(taskId)) as
    { projectId: string; spaceId: string } | undefined;
  return t && ({ point: 'taskPanel', taskId, projectId: t.projectId, spaceId: t.spaceId } as const);
};

/** Запрос в локальную реплику: where — по id и индексам (мост уже проверил), остальное фильтруем в памяти. */
export const queryReplica: BridgeDeps['query'] = async ({ entity, where, ids, limit }) => {
  const t = db.table(entity);
  const w = Object.entries(where);
  let rows: Record<string, unknown>[] = ids
    ? ((await t.bulkGet(ids)).filter(Boolean) as Record<string, unknown>[])
    : w.length
      ? await t
          .where(w[0]![0])
          .equals(w[0]![1] as string)
          .toArray()
      : await t.toArray();
  rows = rows.filter((r) => w.every(([k, v]) => r[k] === v));
  return rows.slice(0, limit);
};

export const mutateVia: BridgeDeps['mutate'] = (pluginId, name, args) =>
  api('POST', `/api/plugins/${pluginId}/mutate`, { name, args });

const dict = {
  panel: { ru: 'Плагины', en: 'Plugins' },
  pages: { ru: 'Плагины', en: 'Plugins' },
  admin: { ru: 'Плагины', en: 'Plugins' },
  reload: { ru: 'Перезагрузите страницу', en: 'Reload the page' },
  refused: { ru: 'Плагин не показан: недопустимый адрес', en: 'Plugin hidden: invalid URL' },
  none: { ru: 'Плагинов нет', en: 'No plugins' },
  name: { ru: 'Название', en: 'Name' },
  url: { ru: 'Адрес (URL)', en: 'URL' },
  read: { ru: 'Чтение', en: 'Read' },
  write: { ru: 'Запись', en: 'Write' },
  taskPanel: { ru: 'Панель задачи', en: 'Task panel' },
  page: { ru: 'Страница', en: 'Page' },
  label: { ru: 'Подпись', en: 'Label' },
  add: { ru: 'Добавить', en: 'Add' },
  remove: { ru: 'Удалить', en: 'Delete' },
  enabled: { ru: 'Включён', en: 'Enabled' },
} as const;
export type Key = keyof typeof dict;
export const tr = (k: Key): string => dict[k][locale()] ?? dict[k].ru;
