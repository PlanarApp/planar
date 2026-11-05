import type { Component } from 'vue';
import { CalendarDays, Columns3, List, Table2 } from 'lucide-vue-next';
import type { LocalizedText } from '../modules/types';
import type { Filter } from './filter';
import type { ViewOptions } from './options';

export type { ViewOptions, Filter };
export type { TaskField } from './options';
export type { FilterRule } from './filter';
export interface ViewProps {
  projectId: string;
  options: ViewOptions;
  filter?: Filter | null;
  /** a saved view is open: the layout goes into the options draft (update:options) */
  saved?: boolean;
  /**
   * group summary (Space, Workspace): tasks of these projects; `projectId` — the summary key for
   * storage, task creation and manual order are disabled
   */
  scope?: {
    projectIds: string[];
    spaceIds: string[];
    /** where to create tasks from the summary (chosen in the panel); none — creation is disabled */
    createIn?: { projectId: string; spaceId: string };
    /** "My work": a created task is assigned to me, not to the project's default assignee */
    createAssigneeId?: string;
  };
}
export { useViewOptions } from './options';
export { matchFilter } from './filter';
export { useSelection } from './selection';
export { openTask, closeTask, taskPanelLoader, viewLoaders } from './open';

export interface ViewTab {
  key: string;
  label: LocalizedText;
  icon?: Component;
  load: () => Promise<{ default: Component }>;
  /** a built-in view receives only ViewProps, a module view also gets viewId */
  ext?: boolean;
}

const BUILTIN: Record<string, Component> = {
  list: List,
  board: Columns3,
  table: Table2,
  calendar: CalendarDays,
};
const ORDER = ['list', 'board', 'table', 'calendar'];

/** Tabs: built-in views from glob (list, board, then the others by name) and module views. */
export function buildViewTabs(
  glob: Record<string, () => Promise<unknown>>,
  ext: { key: string; label: LocalizedText; icon?: Component; component: ViewTab['load'] }[],
): ViewTab[] {
  const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);
  const builtin = Object.entries(glob)
    .flatMap(([path, load]) => {
      const id = /(?:^|\/)([^/]+)\/View\.vue$/.exec(path)?.[1];
      return id ? [{ id, load: load as ViewTab['load'] }] : [];
    })
    .sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id))
    .map(({ id, load }) => ({
      key: id,
      label: id in BUILTIN ? `views.${id}` : { ru: id, en: id },
      icon: BUILTIN[id],
      load,
    }));
  return [
    ...builtin,
    ...ext.map((e) => ({ key: e.key, label: e.label, icon: e.icon, load: e.component, ext: true })),
  ];
}
