/** Группы: три уровня и общие табы (Задачи — любой ключ вида, напр. `/p/<id>/board`). */
export type GroupLevel = 'workspace' | 'space' | 'project';
export const GROUP_TABS = ['inbox', 'tasks', 'docs', 'chats', 'reports', 'settings'] as const;
export type GroupTab = (typeof GROUP_TABS)[number];

export const groupTab = (seg: unknown): GroupTab =>
  GROUP_TABS.includes(seg as GroupTab) ? (seg as GroupTab) : 'tasks';

export function groupUrl(level: GroupLevel, id: string, tab: GroupTab = 'tasks'): string {
  const base = level === 'project' ? `/p/${id}` : level === 'space' ? `/s/${id}` : '/w';
  return tab === 'tasks' ? base : `${base}/${tab}`;
}
