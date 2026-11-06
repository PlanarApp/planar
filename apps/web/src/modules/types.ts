import type { Component } from 'vue';
import type { RouteLocationNormalizedLoaded, RouteLocationRaw, RouteRecordRaw } from 'vue-router';
import type { FrontendModuleManifest } from '@planar/shared';

export const EXTENSION_KINDS = [
  'routes',
  'views',
  'taskPanels',
  'commands',
  'fieldTypes',
  'settings',
  'nav',
  'topbar',
  'search',
  'groupTabs',
] as const;
export type ExtensionKind = (typeof EXTENSION_KINDS)[number];

/** String — key of the web dictionary, object — ready module text. */
export type LocalizedText = string | { ru: string; en: string };

// P — component props type (documenting parameter)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type Lazy<P> = () => Promise<{ default: Component }>;

export interface ViewDef {
  id: string;
  label: LocalizedText;
  icon: Component;
  component: Lazy<{ projectId: string; viewId?: string; scope?: ViewScope }>;
  /** view supports a group summary (Space, Workspace): receives a scope with projects (C-modules v12) */
  scope?: boolean;
}
/** group summary for the view: projects and their spaces; the view's projectId is then the summary key */
export interface ViewScope {
  projectIds: string[];
  spaceIds: string[];
}
export interface TaskPanelDef {
  id: string;
  label: LocalizedText;
  icon?: Component;
  order?: number;
  /** a property row of the task card (label + the component, e.g. a picker) instead of a tab */
  property?: boolean;
  /** the same component also on every task card/row of the views, always visible (time tracking) */
  card?: boolean;
  /** the task's records of the module (Dexie, run in a live query); > 0 or a non-empty string ("1/3") is shown on the tab */
  count?: (taskId: string) => Promise<number | string>;
  component: Lazy<{ taskId: string }>;
}
export interface CommandCtx {
  route: RouteLocationNormalizedLoaded;
  selectedTaskIds: string[];
  projectId?: string;
}
export interface CommandDef {
  id: string;
  label: LocalizedText;
  icon?: Component;
  shortcut?: string;
  group?: LocalizedText;
  /** visible also in the "New task" button menu of the view (C-modules v11) */
  newTaskMenu?: boolean;
  when?: (ctx: CommandCtx) => boolean;
  run: (ctx: CommandCtx) => void | Promise<void>;
}
export interface FieldTypeDef {
  id: string;
  label: LocalizedText;
  cell: Lazy<{ value: unknown }>;
  editor: Lazy<{ value: unknown; 'onUpdate:value': (v: unknown) => void }>;
}
export interface SettingsPageDef {
  id: string;
  label: LocalizedText;
  icon?: Component;
  component: Lazy<object>;
  /** hidden from non-admins of the instance (the server still checks rights) */
  adminOnly?: boolean;
  /** group settings level (C-modules v12): default Workspace; the page receives spaceId and projectId */
  level?: 'workspace' | 'space' | 'project';
}

export type NavItemDef = { id: string; order?: number } & (
  | { label: LocalizedText; icon: Component; /** /m/<moduleId>/… */ to: string }
  | { section: Lazy<object> }
);
/** Group: Workspace (data in the root space), Space, or Project. */
export interface GroupScope {
  level: 'workspace' | 'space' | 'project';
  /** group's space; for Workspace — the root one ("General") */
  spaceId: string;
  projectId: string | null;
  rootSpaceId: string;
}
/** Group tab content (data of its level and nested); for Reports — sub-tabs by label. */
export interface GroupTabDef {
  id: string;
  tab: 'work' | 'docs' | 'chats' | 'reports' | 'settings';
  label?: LocalizedText;
  icon?: Component;
  order?: number;
  component: Lazy<{ scope: GroupScope }>;
}

export interface TopbarItemDef {
  id: string;
  component: Lazy<object>;
  order?: number;
}

export interface SearchHit {
  id: string;
  title: string;
  subtitle?: string;
  icon?: Component;
  to: RouteLocationRaw;
}
/** Cmd+K search over module data (local replica); the palette waits no longer than its debounce. */
export interface SearchProviderDef {
  id: string;
  label: LocalizedText;
  search(q: string, limit: number): Promise<SearchHit[]>;
}
export type SearchDef = SearchProviderDef;

export interface WebModuleManifest extends FrontendModuleManifest {
  routes?: RouteRecordRaw[];
  views?: ViewDef[];
  taskPanels?: TaskPanelDef[];
  commands?: CommandDef[];
  fieldTypes?: FieldTypeDef[];
  settings?: SettingsPageDef[];
  nav?: NavItemDef[];
  topbar?: TopbarItemDef[];
  search?: SearchProviderDef[];
  groupTabs?: GroupTabDef[];
  /** Settings component: a dialog in ModulesSettings, including for a disabled module (C-modules v11) */
  setup?: Lazy<object>;
}

export const defineWebModule = (m: WebModuleManifest): WebModuleManifest => m;
