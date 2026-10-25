/** Группы: три уровня и общие табы (Задачи — любой ключ вида, напр. `/p/<id>/board`). */
export type GroupLevel = 'workspace' | 'space' | 'project';
export const GROUP_TABS = ['work', 'tasks', 'docs', 'chats', 'reports', 'settings'] as const;
export type GroupTab = (typeof GROUP_TABS)[number];

export const groupTab = (seg: unknown): GroupTab =>
  GROUP_TABS.includes(seg as GroupTab) ? (seg as GroupTab) : 'tasks';

export function groupUrl(level: GroupLevel, id: string, tab: GroupTab = 'tasks'): string {
  const base = level === 'project' ? `/p/${id}` : level === 'space' ? `/s/${id}` : '/w';
  return tab === 'tasks' ? base : `${base}/${tab}`;
}

/** Уровень внутри группы: пространство (projectId = null) или проект. */
export interface GroupLevelRow {
  key: string;
  level: GroupLevel;
  title: string;
  spaceId: string;
  projectId: string | null;
}

/**
 * Уровни группы сверху вниз: свой и вложенные (Воркспейс → корневое пространство, пространства и их
 * проекты; Пространство → само и его проекты; Проект → он сам).
 */
export function groupLevels(
  scope: { level: GroupLevel; spaceId: string; projectId: string | null; rootSpaceId: string },
  spaces: { id: string; name: string; projects: { id: string; name: string }[] }[],
  workspaceTitle: string,
): GroupLevelRow[] {
  const space = (s: (typeof spaces)[number]): GroupLevelRow[] => [
    { key: s.id, level: 'space', title: s.name, spaceId: s.id, projectId: null },
    ...s.projects.map((p) => ({
      key: p.id,
      level: 'project' as const,
      title: p.name,
      spaceId: s.id,
      projectId: p.id,
    })),
  ];
  if (scope.level === 'project') {
    const s = spaces.find((x) => x.id === scope.spaceId);
    const p = s?.projects.find((x) => x.id === scope.projectId);
    return p && s
      ? [{ key: p.id, level: 'project', title: p.name, spaceId: s.id, projectId: p.id }]
      : [];
  }
  if (scope.level === 'space') {
    const s = spaces.find((x) => x.id === scope.spaceId);
    return s ? space(s) : [];
  }
  return [
    {
      key: scope.rootSpaceId,
      level: 'workspace',
      title: workspaceTitle,
      spaceId: scope.rootSpaceId,
      projectId: null,
    },
    ...spaces.filter((s) => s.id !== scope.rootSpaceId).flatMap(space),
  ];
}
