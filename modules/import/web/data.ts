// The web part's single point of contact with core: replica, user, language; the module's HTTP — fetch.
import { db, i18n, useQuery } from '@planar/web/modules';
import type { ImportJob, Mapping, Preview } from '../shared/index.js';

export const useProjects = () =>
  useQuery(
    () =>
      db.table('projects').toArray() as Promise<{ id: string; name: string; spaceId: string }[]>,
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
const form = (file: File, fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  f.append('file', file);
  return f;
};

export const previewFile = (file: File, format: string, preset: string) =>
  call<Preview>('POST', '/api/import/preview', form(file, { format, preset }));
export const startJob = async (
  file: File,
  a: { projectId: string; format: string; preset: string; mapping: Mapping },
) =>
  (
    await call<{ data: ImportJob }>(
      'POST',
      '/api/import/jobs',
      form(file, { ...a, mapping: JSON.stringify(a.mapping) }),
    )
  ).data;
export const getJob = async (id: string) =>
  (await call<{ data: ImportJob }>('GET', `/api/import/jobs/${id}`)).data;

const dict = {
  title: { ru: 'Импорт задач', en: 'Import tasks' },
  file: { ru: 'Файл', en: 'File' },
  format: { ru: 'Формат', en: 'Format' },
  preset: { ru: 'Источник', en: 'Source' },
  project: { ru: 'Проект', en: 'Project' },
  preview: { ru: 'Предпросмотр', en: 'Preview' },
  next: { ru: 'Далее', en: 'Next' },
  back: { ru: 'Назад', en: 'Back' },
  start: { ru: 'Импортировать', en: 'Import' },
  mapping: { ru: 'Сопоставление колонок', en: 'Column mapping' },
  statuses: { ru: 'Статусы', en: 'Statuses' },
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
