/** Groups: three levels and shared tabs (Tasks — any view key, e.g. `/p/<id>/board`). */
export type GroupLevel = 'workspace' | 'space' | 'project';
export const GROUP_TABS = [
  'work',
  'tasks',
  'docs',
  'chats',
  'reports',
  'spaces',
  'projects',
  'settings',
] as const;
export type GroupTab = (typeof GROUP_TABS)[number];

export const groupTab = (seg: unknown): GroupTab =>
  GROUP_TABS.includes(seg as GroupTab) ? (seg as GroupTab) : 'tasks';

/** level tabs: lists of nested groups — Workspace has spaces and projects, Space has projects */
export const tabsFor = (level: GroupLevel): GroupTab[] =>
  GROUP_TABS.filter(
    (k) => (k !== 'spaces' || level === 'workspace') && (k !== 'projects' || level !== 'project'),
  );

/** Group tab address; Tasks — the last chosen view (PLNRAPP-111), `list` by default: the bare node
 * address opens the remembered tab. */
export function groupUrl(level: GroupLevel, id: string, tab: GroupTab = 'tasks'): string {
  const base = level === 'project' ? `/p/${id}` : level === 'space' ? `/s/${id}` : '/w';
  return `${base}/${tab === 'tasks' ? lastView.get() : tab}`;
}

/** Last chosen Tasks view key (list, board, a module view); a view missing at the level — the first one. */
const VIEW_KEY = 'planar.tasksView';
export const lastView = {
  get(): string {
    try {
      return localStorage.getItem(VIEW_KEY) || 'list';
    } catch {
      return 'list';
    }
  },
  set(v: string) {
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* no storage — List after reload */
    }
  },
};

/** Last opened node tab: group tab or Tasks view key, and the "My work" section (?w). */
export interface LastTab {
  seg: string;
  w?: string;
}
const LAST_KEY = 'planar.groupTab';
export const lastTab = {
  // by default — "My work"
  get(): LastTab {
    try {
      const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null');
      if (v && typeof v.seg === 'string' && v.seg)
        return typeof v.w === 'string' ? { seg: v.seg, w: v.w } : { seg: v.seg };
    } catch {
      /* no storage or broken JSON */
    }
    return { seg: 'work' };
  },
  set(v: LastTab) {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify(v));
    } catch {
      /* no storage — default tab after reload */
    }
  },
};

/** Where the bare node address leads: the remembered tab (the level's own tab check is on the group screen). */
export function nodeLanding(
  path: string,
  last: LastTab,
): { path: string; query: Record<string, string> } {
  return {
    path: `${path.replace(/\/$/, '')}/${last.seg}`,
    query: last.seg === 'work' && last.w ? { w: last.w } : {},
  };
}

/** Level within a group: space (projectId = null) or project. */
export interface GroupLevelRow {
  key: string;
  level: GroupLevel;
  title: string;
  spaceId: string;
  projectId: string | null;
}

/**
 * Group levels top-down: own and nested (Workspace → root space, spaces and their
 * projects; Space → itself and its projects; Project → itself).
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
