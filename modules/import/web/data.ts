// The web part's single point of contact with core: replica, user, language; the module's HTTP — fetch.
import { db, i18n, useQuery, useSession } from '@planar/web/modules';
import type { ImportJob, Mapping, Preview } from '../shared/index.js';

export { useSession };
/** spaces for the import: without the root one (Workspace) — it holds no projects */
export const useSpaces = () =>
  useQuery(async () => {
    const root = (await db.table('settings').get('root_space'))?.value;
    const all = (await db.table('spaces').toArray()) as {
      id: string;
      name: string;
      rank: string;
    }[];
    return all.filter((s) => s.id !== root).sort((a, b) => (a.rank < b.rank ? -1 : 1));
  });
export const useProjects = () =>
  useQuery(
    () =>
      db.table('projects').toArray() as Promise<
        { id: string; name: string; key: string; spaceId: string; archivedAt: string | null }[]
      >,
  );
export const useUsers = () =>
  useQuery(
    () =>
      db.table('users').toArray() as Promise<
        {
          id: string;
          name: string;
          login: string;
          email?: string | null;
          deactivatedAt: string | null;
        }[]
      >,
  );
export const useStatuses = () =>
  useQuery(
    () =>
      db.table('statuses').toArray() as Promise<
        { id: string; name: string; spaceId: string; projectId: string; rank: string }[]
      >,
  );

async function call<T>(method: string, path: string, body?: FormData): Promise<T> {
  const res = await fetch(path, { method, credentials: 'same-origin', body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { message?: string }).message || res.statusText);
  return data as T;
}
/** Plane API connection (format plane-api) — instead of a file */
export type PlaneConn = { url: string; workspace: string; token: string };
const form = (src: File | PlaneConn, fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  if (src instanceof File) f.append('file', src);
  else for (const [k, v] of Object.entries(src)) f.append(k, v);
  return f;
};

export const previewFile = (
  src: File | PlaneConn,
  format: string,
  preset: string,
  mapping?: Mapping,
) =>
  call<Preview>(
    'POST',
    '/api/import/preview',
    form(src, { format, preset, ...(mapping && { mapping: JSON.stringify(mapping) }) }),
  );
export const startJob = async (
  src: File | PlaneConn,
  a: { spaceId: string; projectId: string; format: string; preset: string; mapping: Mapping },
) =>
  (
    await call<{ data: ImportJob }>(
      'POST',
      '/api/import/jobs',
      form(src, { ...a, mapping: JSON.stringify(a.mapping) }),
    )
  ).data;
export const getJob = async (id: string) =>
  (await call<{ data: ImportJob }>('GET', `/api/import/jobs/${id}`)).data;

const dict = {
  title: { ru: 'Импорт задач', en: 'Import tasks' },
  file: { ru: 'Файл', en: 'File' },
  planeUrl: { ru: 'Адрес Plane', en: 'Plane address' },
  planeWorkspace: { ru: 'Воркспейс (slug из адреса)', en: 'Workspace (slug from the address)' },
  planeToken: { ru: 'API-токен Plane', en: 'Plane API token' },
  planeHint: {
    ru: 'Задачи, описания и комментарии с форматированием читаются из API Plane сервером Planar. Токен хранится только пока идёт импорт.',
    en: 'Issues, descriptions and comments with formatting are read from the Plane API by the Planar server. The token is kept only while the import runs.',
  },
  format: { ru: 'Формат', en: 'Format' },
  preset: { ru: 'Источник', en: 'Source' },
  project: { ru: 'Проект', en: 'Project' },
  preview: { ru: 'Предпросмотр', en: 'Preview' },
  next: { ru: 'Далее', en: 'Next' },
  back: { ru: 'Назад', en: 'Back' },
  start: { ru: 'Импортировать', en: 'Import' },
  mapping: { ru: 'Сопоставление колонок', en: 'Column mapping' },
  statuses: { ru: 'Статусы', en: 'Statuses' },
  projects: { ru: 'Проекты из файла', en: 'Projects from the file' },
  people: { ru: 'Люди из файла', en: 'People from the file' },
  space: { ru: 'Пространство', en: 'Space' },
  projectOptional: {
    ru: 'Проект для строк без своего проекта (необязательно)',
    en: 'Project for rows without one (optional)',
  },
  mainProject: { ru: 'основной проект', en: 'main project' },
  skipRows: { ru: 'пропустить строки', en: 'skip the rows' },
  createNew: { ru: 'создать', en: 'create' },
  createBacklog: { ru: 'создать: бэклог', en: 'create: backlog' },
  createTodo: { ru: 'создать: к работе', en: 'create: to do' },
  createInProgress: { ru: 'создать: в работе', en: 'create: in progress' },
  createDone: { ru: 'создать: готово', en: 'create: done' },
  createCancelled: { ru: 'создать: отменено', en: 'create: cancelled' },
  noMatch: { ru: '— не сопоставлять —', en: '— do not match —' },
  createHint: {
    ru: 'Новые пользователи создаются без пароля и добавляются в пространство; войти смогут, когда администратор задаст пароль.',
    en: 'New users are created without a password and added to the space; they can sign in once an admin sets a password.',
  },
  byDefault: { ru: 'по умолчанию', en: 'default' },
  none: { ru: '— нет —', en: '— none —' },
  progress: { ru: 'Обработано', en: 'Processed' },
  created: { ru: 'Создано', en: 'Created' },
  updated: { ru: 'Обновлено', en: 'Updated' },
  skipped: { ru: 'Пропущено', en: 'Skipped' },
  warnings: { ru: 'Предупреждения', en: 'Warnings' },
  row: { ru: 'Строка', en: 'Row' },
  done: { ru: 'Готово', en: 'Done' },
  failed: { ru: 'Ошибка', en: 'Failed' },
  again: { ru: 'Новый импорт', en: 'New import' },
  open: { ru: 'Импорт задач', en: 'Import tasks' },
} as const;
export type Key = keyof typeof dict;
export const tr = (k: Key): string => {
  const l = i18n.global.locale.value as 'ru' | 'en';
  return dict[k][l] ?? dict[k].ru;
};
