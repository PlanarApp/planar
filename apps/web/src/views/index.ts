import type { Component } from 'vue';
import { CalendarDays, Columns3, List, Table2, UserCheck } from 'lucide-vue-next';
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
  /** открыт сохранённый вид: раскладка уходит в черновик опций (update:options) */
  saved?: boolean;
  /**
   * сводка группы (Пространство, Воркспейс): задачи этих проектов; `projectId` — ключ сводки для
   * хранилища, создание задач и ручной порядок выключены
   */
  scope?: { projectIds: string[]; spaceIds: string[] };
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
  /** встроенный вид получает только ViewProps, вид модуля — ещё и viewId */
  ext?: boolean;
}

const BUILTIN: Record<string, Component> = {
  list: List,
  board: Columns3,
  table: Table2,
  calendar: CalendarDays,
  my: UserCheck,
};
const ORDER = ['list', 'board', 'table', 'calendar', 'my'];

/** Вкладки: встроенные виды из glob (list, board, затем остальные по имени) и виды модулей. */
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
