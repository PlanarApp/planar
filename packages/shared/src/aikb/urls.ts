/** Ссылки на страницы Planar по публичному адресу инстанса (контракт aikb-urls v1). Шаблоны — по apps/web/src/router.ts и маршрутам модулей. */
export type AppTarget =
  | { kind: 'task'; key: string }
  | { kind: 'doc'; pageId: string }
  /** личный чат; без channelId — последний открытый */
  | { kind: 'chat'; channelId?: string }
  /** канал задачи / документа — обычный канал чата */
  | { kind: 'taskChat' | 'docChat'; channelId: string }
  | { kind: 'project'; projectId: string; view?: string }
  | { kind: 'space'; spaceId: string; tab?: string }
  | { kind: 'section'; section: 'board' | 'list' | 'docs' | 'cycles'; projectId: string }
  /** настройки проекта (projectId) или рабочей области */
  | { kind: 'section'; section: 'settings'; projectId?: string }
  | { kind: 'section'; section: 'aiTasks' }
  /** комментарий задачи (id — ключ) или страницы (id — pageId) */
  | { kind: 'comment'; on: 'task' | 'page'; id: string; commentId: string };

const e = encodeURIComponent;
/** Путь с query без базы (для теста роутера). */
export function appPath(t: AppTarget): string {
  switch (t.kind) {
    case 'task':
      return `/t/${e(t.key)}`;
    case 'doc':
      return `/m/docs/${e(t.pageId)}`;
    case 'chat':
      return t.channelId ? `/m/chat/c/${e(t.channelId)}` : '/m/chat/';
    case 'taskChat':
    case 'docChat':
      return `/m/chat/c/${e(t.channelId)}`;
    case 'project':
      return `/p/${e(t.projectId)}${t.view ? `/${e(t.view)}` : ''}`;
    case 'space':
      return `/s/${e(t.spaceId)}${t.tab ? `/${e(t.tab)}` : ''}`;
    case 'comment':
      return `${t.on === 'task' ? `/t/${e(t.id)}` : `/m/docs/${e(t.id)}`}?comment=${e(t.commentId)}`;
    case 'section':
      switch (t.section) {
        case 'board':
        case 'list':
          return `/p/${e(t.projectId)}/${t.section}`;
        case 'docs':
          return `/p/${e(t.projectId)}/docs`;
        case 'cycles':
          return `/p/${e(t.projectId)}/reports?r=sprints:sprint`;
        case 'settings':
          return t.projectId ? `/p/${e(t.projectId)}/settings` : '/w/settings';
        case 'aiTasks':
          return '/w/settings?s=ai:workspace&tab=tasks';
      }
  }
}

/** Полный URL: base — публичный адрес инстанса (PUBLIC_URL), хвостовые `/` убираются. */
export const appUrl = (base: string, t: AppTarget): string => base.replace(/\/+$/, '') + appPath(t);
