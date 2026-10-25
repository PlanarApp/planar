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
] as const;
export type ExtensionKind = (typeof EXTENSION_KINDS)[number];

/** Строка — ключ словаря web, объект — готовый текст модуля. */
export type LocalizedText = string | { ru: string; en: string };

// P — тип пропсов компонента (документирующий параметр)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type Lazy<P> = () => Promise<{ default: Component }>;

export interface ViewDef {
  id: string;
  label: LocalizedText;
  icon: Component;
  component: Lazy<{ projectId: string; viewId?: string }>;
}
export interface TaskPanelDef {
  id: string;
  label: LocalizedText;
  icon?: Component;
  order?: number;
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
  /** видна и в меню кнопки «Новая задача» вида (C-modules v11) */
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
  /** скрыт от не-админов инстанса (сервер всё равно проверяет права) */
  adminOnly?: boolean;
}

export type NavItemDef = { id: string; order?: number } & (
  | { label: LocalizedText; icon: Component; /** /m/<moduleId>/… */ to: string }
  | { section: Lazy<object> }
);
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
/** Поиск Cmd+K по данным модуля (локальная реплика); палитра ждёт не дольше своего debounce. */
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
  /** Компонент настройки: диалог в ModulesSettings, в том числе у выключенного модуля (C-modules v11) */
  setup?: Lazy<object>;
}

export const defineWebModule = (m: WebModuleManifest): WebModuleManifest => m;
