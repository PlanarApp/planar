// The module's single point of contact with the web core: replica, mutations, language.
import { db, i18n, mutate, useQuery } from '@planar/web/modules';
import type { GitlabMr } from '../shared/index.js';

export { mutate };
export interface ProjectLite {
  id: string;
  spaceId: string;
  name: string;
}
export interface StatusLite {
  id: string;
  spaceId: string;
  name: string;
}

export const useMrs = (taskId: () => string) =>
  useQuery(
    () => db.table('gitlabMrs').where('taskId').equals(taskId()).toArray() as Promise<GitlabMr[]>,
  );
export const useProjects = () =>
  useQuery(
    async () =>
      (await db.table('projects').toArray()).filter((p) => !p.archivedAt) as ProjectLite[],
  );
export const useStatusList = () =>
  useQuery(() => db.table('statuses').toArray() as Promise<StatusLite[]>);
/** projectId → mergedStatusId */
export const useMergedStatuses = () =>
  useQuery(async () => {
    const rows = (await db.table('gitlabProjectSettings').toArray()) as {
      id: string;
      mergedStatusId: string | null;
    }[];
    return Object.fromEntries(rows.map((r) => [r.id, r.mergedStatusId]));
  });

const dict = {
  mrs: { ru: 'GitLab', en: 'GitLab' },
  noMrs: { ru: 'Нет связанных MR', en: 'No linked MRs' },
  opened: { ru: 'открыт', en: 'open' },
  closed: { ru: 'закрыт', en: 'closed' },
  locked: { ru: 'заблокирован', en: 'locked' },
  merged: { ru: 'смержен', en: 'merged' },
  title: { ru: 'GitLab', en: 'GitLab' },
  baseUrl: { ru: 'Адрес GitLab', en: 'GitLab URL' },
  token: { ru: 'Токен доступа', en: 'Access token' },
  newToken: { ru: 'Новый токен', en: 'New token' },
  save: { ru: 'Сохранить', en: 'Save' },
  connections: { ru: 'Подключения', en: 'Connections' },
  repo: { ru: 'Репозиторий (id или group/name)', en: 'Repository (id or group/name)' },
  add: { ru: 'Подключить', en: 'Connect' },
  remove: { ru: 'Убрать', en: 'Remove' },
  poll: { ru: 'Опросить сейчас', en: 'Poll now' },
  polled: { ru: 'опрошен', en: 'polled' },
  error: { ru: 'Ошибка', en: 'Error' },
  merge: { ru: 'MR смержен → статус', en: 'MR merged → status' },
  off: { ru: 'не менять', en: 'do not change' },
} as const;
export type Key = keyof typeof dict;
export const tr = (k: Key): string => {
  const l = i18n.global.locale.value as 'ru' | 'en';
  return dict[k][l] ?? dict[k].ru;
};
