---
type: contract
status: closed
module: design
updated: 2026-11-02
summary: Contract C-ui v5 - tokens, contrast, density, base components, routes and extension points of web
related: ["docs/plan/design.md", "docs/contracts/web.md", "docs/contracts/work.md", "docs/roadmap.md"]
contracts: [{"id": "C-ui", "version": 5}]
---

# Contract C-ui (web interface)

Owner - the design coordinator (before phase 3 - the web coordinator). Consumers - web (`apps/web`), all `modules/*/web`, module `p3`. Only the coordinator changes it: version +1 in the heading and in `apps/web/src/contract.ts`, edit the contract test, notify consumers.

**Contract test** - `apps/web/src/__contract__/ui.contract.test.ts` (written by the coordinator, the executor does not edit it). It checks: the version from the heading `## C-ui vN` (here) and the headings `## C-… vN` from `docs/contracts/web.md` = `UI_CONTRACT_VERSIONS` from `apps/web/src/contract.ts`; every color token is declared in `tokens.css` in both the light and the dark block, sizes - in `@theme`; the pairs from "Contrast" are not below the threshold in both themes; every component from the list is exported from `apps/web/src/ui/index.ts`; `EXTENSION_KINDS` = the list of extension points below. Run: `pnpm --filter web test`. The test finds sections by their Russian heading prefix, so the headings of the sections "Color tokens", "Fonts, spacing, sizes", "Contrast", "Base components", "Extension points" keep the Russian prefix.

## C-ui v5

v5 (nav-polish): `FavStar` - favourite toggle (grey / yellow star) for node headers and module entities (chats). Compatible with v4.
v4 (design, DS-0b): `Menu` without the `trigger` slot renders its own `IconButton` "..." (`MoreHorizontal`) with the `label` caption - modules without the `lucide-vue-next` dependency do not need their own icons; `Input` passes attributes (`required`, `maxlength`, `name`, `autocomplete`, `data-*`) to `<input>`, not to the wrapper. Compatible with v3.

v3 (design, DS-0): visual style "dense and strict, like Linear" (`docs/plan/design.md` §4). Neutral scale, sidebar tokens, shadows, font scale 11-20 px with a 13 px base, contrast check, new components (IconButton, ConfirmDialog, Tabs, Chip, AvatarStack, Kbd, EmptyState, Toolbar), density and destructive-action rules, showcase `/dev/ui`. Compatible with v2: v2 props and events are kept, token values and the look of components change. The `Button` variant `danger` is only for the confirm button in `ConfirmDialog`; DS-4 migrates its other uses.
v2 (collab, CL-1a): extension point `search` (`EXTENSION_KINDS` += `search`) - `docs/contracts/collab.md` §X-core item 5; Inbox shows notifications without a task by `body` and leads to `url`.

Modules (`modules/<id>/web/`) import web only from the SDK `@planar/web/modules` (`docs/contracts/work.md` §C-modules v4); direct import `@planar/web/<path>` is forbidden (the temporary `exports["./*"]` from CL-4 is removed by CL-6). Module tests - `modules/*/web/**/*.test.ts`, run by the web project (`apps/web/vitest.config.ts`). Everything from `apps/web/src/ui/index.ts` reaches the SDK via `export * from '../ui'` in `apps/web/src/modules/sdk.ts` (additions are additive, the C-modules list does not change).

### Files
| Path | What |
|---|---|
| `apps/web/src/contract.ts` | `export const UI_CONTRACT_VERSIONS = { 'C-ui': 4, 'C-client': 4, 'C-tasks': 3, 'C-views': 2 } as const;` |
| `apps/web/src/ui/tokens.css` | tokens: the `@theme { … }` block - light theme and shared sizes, the `.dark { … }` block - dark theme (same color names) |
| `apps/web/src/ui/index.ts` | export of components and `useBreakpoint`, `useTheme` |
| `apps/web/src/styles.css` | base: `body` - `font-size: var(--text-sm)` (13 px), `line-height: var(--text-sm--line-height)` |
| `apps/web/src/screens/DevUiScreen.vue` | showcase `/dev/ui`: all components and variants, theme switcher; dev only |
| `apps/web/src/i18n/{index,ru,en}.ts` | vue-i18n, dictionaries; component strings - keys `ui.*` |
| `apps/web/src/modules/types.ts` | extension point types, `EXTENSION_KINDS`, `defineWebModule` |
| `apps/web/src/modules/registry.ts` | `registerModules(manifests)`, `useExtensions(kind)` |

### Color tokens
Tailwind 4: names in `@theme` produce utilities (`--color-bg` -> `bg-bg`, `text-fg`, `border-border`). Components use only these utilities or `var(--color-…)`; color literals are forbidden (except a `color` value from data: statuses, labels). A token value is `#rrggbb` or `var(--color-…)` of another token (this is how the contrast check reads them).

The neutral scale has 10 steps by role, not by lightness: in the light theme 1 is the lightest, in the dark theme the darkest. Semantic tokens refer to the scale or have their own value.

| Token | Purpose |
|---|---|
| `--color-neutral-1` | app background |
| `--color-neutral-2` | raised background (group headers, panels) |
| `--color-neutral-3` | hover |
| `--color-neutral-4` | pressed, selected neutral |
| `--color-neutral-5` | border |
| `--color-neutral-6` | field border, strong border |
| `--color-neutral-7` | inactive, decorative icons (not text) |
| `--color-neutral-8` | tertiary text, placeholders |
| `--color-neutral-9` | secondary text |
| `--color-neutral-10` | primary text |
| `--color-bg` | app background |
| `--color-bg-subtle` | background of group headers, panels |
| `--color-bg-muted` | row hover, inactive fields |
| `--color-surface` | popovers, dialogs, board cards |
| `--color-overlay` | backdrop under a dialog (may be `#rrggbbaa`; not part of the contrast check) |
| `--color-border` | regular border |
| `--color-border-strong` | input field border |
| `--color-fg` | primary text |
| `--color-fg-muted` | secondary text |
| `--color-fg-subtle` | hints, placeholders, icons |
| `--color-accent` | primary action, selected, links (the only accent) |
| `--color-accent-fg` | text on `accent` |
| `--color-accent-subtle` | selected row background |
| `--color-danger` | dangerous action, error (`danger-ghost` text) |
| `--color-danger-fg` | text on `danger` |
| `--color-danger-subtle` | hover of a dangerous menu item and `danger-ghost` |
| `--color-warning` | warning, due soon |
| `--color-success` | success |
| `--color-focus` | focus ring (`focus-visible`, 2px) |
| `--color-sidebar-bg` | sidebar background (dark in both themes) |
| `--color-sidebar-fg` | sidebar primary text |
| `--color-sidebar-fg-muted` | sidebar secondary text, icons, group headers |
| `--color-sidebar-hover` | sidebar item hover |
| `--color-sidebar-active` | selected sidebar item |
| `--color-sidebar-border` | sidebar dividers |
| `--color-priority-urgent` | priority 1 |
| `--color-priority-high` | priority 2 |
| `--color-priority-medium` | priority 3 |
| `--color-priority-low` | priority 4 |

### Contrast
Contrast per WCAG 2.1 (sRGB relative luminance), in both themes (dark - values from `.dark`, missing references - from `@theme`). Checked by the contract test against `tokens.css`.

| Text | Background | Not below |
|---|---|---|
| `--color-fg` | `--color-bg` | 4.5 |
| `--color-fg` | `--color-bg-subtle` | 4.5 |
| `--color-fg` | `--color-bg-muted` | 4.5 |
| `--color-fg` | `--color-surface` | 4.5 |
| `--color-fg` | `--color-accent-subtle` | 4.5 |
| `--color-fg-muted` | `--color-bg` | 4.5 |
| `--color-fg-muted` | `--color-bg-subtle` | 4.5 |
| `--color-fg-muted` | `--color-surface` | 4.5 |
| `--color-fg-subtle` | `--color-bg` | 4.5 |
| `--color-fg-subtle` | `--color-surface` | 4.5 |
| `--color-accent` | `--color-bg` | 4.5 |
| `--color-accent-fg` | `--color-accent` | 4.5 |
| `--color-danger` | `--color-bg` | 4.5 |
| `--color-danger` | `--color-surface` | 4.5 |
| `--color-danger-fg` | `--color-danger` | 4.5 |
| `--color-warning` | `--color-bg` | 4.5 |
| `--color-success` | `--color-bg` | 4.5 |
| `--color-sidebar-fg` | `--color-sidebar-bg` | 4.5 |
| `--color-sidebar-fg` | `--color-sidebar-active` | 4.5 |
| `--color-sidebar-fg-muted` | `--color-sidebar-bg` | 4.5 |
| `--color-focus` | `--color-bg` | 3 |

### Theme
- `useTheme()` -> `{ theme: Ref<'system'|'light'|'dark'>, resolved: Ref<'light'|'dark'> }`; stored in `localStorage['planar.theme']`, default `system` (follows `prefers-color-scheme`).
- Dark theme - the `dark` class on `<html>`; in Tailwind - `@custom-variant dark (&:where(.dark, .dark *));`. The class is set before mounting (a script in `index.html`), without flicker.

### Fonts, spacing, sizes
Base - 13 px (`text-sm`, set on `body`). Scale 11/12/13/14/16/20: `text-2xs` - counters, `Kbd`, small badges; `text-xs` - secondary text, IDs, captions; `text-sm` - primary text, rows, buttons, fields; `text-base` - dialog titles, fields on mobile; `text-lg` - section titles, task description; `text-xl` - page and task title. Line height is set for each size (`--text-*--line-height`). Weights - 400 and 500 (headings - 600).

| Token | Value |
|---|---|
| `--font-sans` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` (no web fonts) |
| `--font-mono` | `ui-monospace, SFMono-Regular, Menlo, monospace` - task IDs (`PLN-123`), `Kbd`, code |
| `--text-2xs` | 11px |
| `--text-2xs--line-height` | 16px |
| `--text-xs` | 12px |
| `--text-xs--line-height` | 16px |
| `--text-sm` | 13px (base) |
| `--text-sm--line-height` | 20px |
| `--text-base` | 14px |
| `--text-base--line-height` | 20px |
| `--text-lg` | 16px |
| `--text-lg--line-height` | 24px |
| `--text-xl` | 20px |
| `--text-xl--line-height` | 28px |
| `--radius-sm` | 4px - chips, badges, `Kbd`, checkboxes |
| `--radius-md` | 6px - buttons, fields, menu items |
| `--radius-lg` | 8px - popovers, dialogs, board cards |
| `--shadow-popover` | shadow of a popover, menu, dropdown, tooltip |
| `--shadow-dialog` | dialog shadow |

Shadows only on floating elements (`Popover`, `Menu`, `Select`, `Tooltip`, `Dialog`); buttons, fields, rows and board cards have a border, no shadow.

### Density
Spacing - the default Tailwind scale (`--spacing: 0.25rem`, 4 px step); values off the 4 px step are forbidden (except 2 px inside `Kbd`, `Badge`, `Chip`).

| Element | Height | Class |
|---|---|---|
| list row | 32 px | `h-8` |
| sidebar item | 28 px | `h-7` |
| button, field, dropdown `sm` / `md` | 28 / 32 px | `h-7` / `h-8` |
| `IconButton` `sm` / `md` | 28 / 32 px, square | `size-7` / `size-8` |
| `Chip`, `Badge` | 20 px | `h-5` |
| `Toolbar` | 44 px | `h-11` |
| menu item | 32 px | `h-8` |

On mobile (< 768 px) interactive targets are >= 44 px (`min-h-11`/`min-w-11` on buttons, fields, menu items).

### Rules
- **Destructive actions** - a "..." menu item (`Menu`, `MenuItem.danger` + `MenuItem.confirm`) with confirmation in `ConfirmDialog`; no solid red button in lists and rows.
- **Empty values** are not shown in rows and cards: no "-", no placeholder icons (no due date - no calendar icon).
- **Secondary actions** - on hover: parent `group`, action `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`; on mobile (no hover) - always visible or in the "..." menu.
- **Task IDs** - `font-mono text-xs text-fg-muted`.
- **Icon button without text** - only `IconButton` (the caption is required; it is also the `aria-label` and the tooltip).
- **Focus** - `focus-visible:outline-2 outline-focus` on all interactive elements.

### Breakpoint
Mobile - width < 768px (Tailwind `md` = 768px, mobile-first styles). In code - `useBreakpoint()` -> `{ isMobile: Ref<boolean> }` via `matchMedia('(max-width: 767.98px)')`.

On mobile (DS-5a, behavior without prop changes): `Popover`, `Menu`, `Select` open as a bottom sheet (full width, top radius `lg`, `overlay` backdrop, closes on backdrop click and Esc); `Dialog` - full screen; `Tooltip` is not shown.

### Base components (`apps/web/src/ui/index.ts`)
C-modules v10: `IconButton`, `ConfirmDialog`, `Tabs`, `Chip`, `AvatarStack`, `Kbd`, `EmptyState`, `Toolbar` are part of the required SDK list (`docs/contracts/work-api.md`, block `sdk-exports=required`; test `apps/web/src/__contract__/sdk.contract.test.ts`).

Built on Reka UI + Tailwind 4, SFC `<script setup lang="ts">`. No user-facing strings inside except `ui.*` keys via `t()` (default captions); other captions come as props. v2 props and events are kept.

| Component | Props and events | Behavior |
|---|---|---|
| `Button` | `variant: 'primary'\|'secondary'\|'ghost'\|'danger-ghost'\|'danger'` = `secondary`; `size: 'sm'\|'md'` = `md`; `icon?: Component`; `iconRight?: Component`; `loading?`, `disabled?`; `type` = `button`; default slot | height 28/32 px; `danger-ghost` - `danger` text, no background, hover `danger-subtle`; `danger` (solid) - only in `ConfirmDialog`; `loading` -> `aria-busy`, button inactive |
| `IconButton` | `icon: Component` (required); `label: string` (required); `variant: 'ghost'\|'secondary'` = `ghost`; `size: 'sm'\|'md'` = `md`; `shortcut?: string`; `active?: boolean`; `disabled?`; event `click` | square 28/32 px; `label` -> `aria-label` and `Tooltip` (with `shortcut`); `active` -> `aria-pressed="true"` and `bg-muted` background |
| `Input` | `v-model: string`; `label: string` (required); `hideLabel?`; `type?`, `placeholder?`, `error?: string`, `disabled?`; `size: 'sm'\|'md'` = `md`; `icon?: Component` (left) | `error` -> `aria-invalid` and text under the field; other attributes (`required`, `maxlength`, `name`, `autocomplete`, `data-*`) - on `<input>`; `class` - on the wrapper |
| `Select` | `v-model: string\|null`; `options: {value: string, label: string, icon?: Component, color?: string}[]`; `label: string`; `placeholder?`, `disabled?`; `size: 'sm'\|'md'` = `md` | Reka keyboard; `color` - an 8 px dot before the caption |
| `Menu` | `items: MenuItem[]`; `side?`, `align?` = `start`; slot `trigger`; `label?: string` (required without the `trigger` slot) | without the `trigger` slot - an `IconButton` with the `MoreHorizontal` icon, `label` -> `aria-label` and tooltip; `MenuItem = {id, label, icon?, shortcut?, danger?, disabled?, confirm?: {title: string, description?: string, confirmLabel: string}, onSelect: () => void} \| {separator: true}`; `danger` - `danger` text, hover `danger-subtle`; `confirm` set -> selecting opens `ConfirmDialog`, `onSelect` runs only after confirmation; `shortcut` - `Kbd` on the right |
| `Popover` | `v-model:open`; `side?`, `align?`; slots `trigger`, default | `shadow-popover` shadow, radius `lg` |
| `Dialog` | `v-model:open`; `title: string` (required); `description?`; `size: 'sm'\|'md'\|'lg'` = `md` (width 400/560/720 px); slots default, `footer` | on mobile - full screen; Esc closes; `overlay` backdrop, `shadow-dialog` shadow |
| `ConfirmDialog` | `v-model:open`; `title: string` (required); `description?`; `confirmLabel: string` (required); `cancelLabel?` = `t('ui.cancel')`; `danger?: boolean` = `true`; event `confirm` | `Dialog` `size="sm"`; buttons "cancel" (`ghost`) and confirm (`danger` or `primary`); focus on open - on "cancel"; confirm -> `confirm`, then close; Esc and "cancel" - close without `confirm` |
| `Tabs` | `v-model: string`; `items: {value: string, label: string, icon?: Component, count?: number}[]`; `label: string` (required, the list's `aria-label`); `size: 'sm'\|'md'` = `sm` | `role="tablist"`/`tab`, `aria-selected`; arrows <-/-> move focus, Enter/Space select; selected - `bg-muted` background, `fg` text; others - `fg-muted`; no wrapping, horizontal scroll on overflow |
| `Chip` | `color?: string` (dot); `icon?: Component`; `removable?: boolean`; `removeLabel?: string` (required when `removable`); event `remove`; default slot | height 20 px, radius `sm`, `bg-muted` background; the cross is a button with `aria-label=removeLabel` |
| `Avatar` | `name: string`; `src?: string\|null`; `size: 'xs'\|'sm'\|'md'\|'lg'` = 16/20/24/32px | without `src` - initials, background color from the hash of `name` |
| `AvatarStack` | `people: {name: string, src?: string\|null}[]`; `max?: number` = 3; `size: 'xs'\|'sm'` = `sm` | avatars overlap (-4 px) with an outline in the background color; more than `max` - the last circle is `+N`; `title` - names separated by commas; an empty list renders nothing |
| `Badge` | `variant: 'solid'\|'soft'\|'outline'` = `soft`; `color?: string`; `dot?: boolean`; default slot | `dot` - an 8 px dot of the `color` and `fg-muted` text without background (labels in rows) |
| `Kbd` | `keys: string` (`'Mod+K'`, `'Shift+Enter'`, `'G I'`) | `+` - simultaneous, space - sequential; `Mod` -> `⌘` on macOS, `Ctrl` elsewhere; each key is a `<kbd>`, `font-mono text-2xs`, `border` border, radius `sm` |
| `EmptyState` | `title: string` (required); `description?`; `icon?: Component`; slot `actions` | centered in the container, >= 48 px top offset, 32 px `fg-subtle` icon, `title` - `text-base`, `description` - `text-sm fg-muted`, text width <= 360 px |
| `Toolbar` | `label: string` (required, `aria-label`); slots default (left), `end` (right) | `role="toolbar"`, height 44 px, bottom border, 4 px gaps; on mobile - a single row with horizontal scroll, no wrapping |
| `Tooltip` | `content: string`; `shortcut?: string`; default slot (trigger) | 400 ms delay; `shortcut` - via `Kbd`; `shadow-popover` shadow |
| `FavStar` | `fav: boolean` (required); event `click` | square 28 px; `Star` icon: `fav` -> filled `warning`, otherwise `fg-subtle`; `aria-pressed` = `fav`; `aria-label` and `Tooltip` - add to / remove from favourites |

### Icons
Only `lucide-vue-next`, imported one by one (`import { Plus } from 'lucide-vue-next'`); size 16 by default, 20 in mobile navigation. No other sets or SVG icon files (except PWA icons).

### i18n
vue-i18n, locales `ru`, `en`. Keys are nested: `<screen>.<element>` (`sidebar.inbox`). Initial locale - `localStorage['planar.locale']`, otherwise `ru` if `navigator.language` starts with `ru`, otherwise `en`. A key missing in `en` falls back to `ru`, with a warning in tests.
`LocalizedText = string | { ru: string; en: string }`: a string is a web dictionary key, an object is ready text (this is how modules without their own dictionaries label elements).

### Routes (WB-1 creates them, screens are stubs until their own tasks)
| Path | Screen | Task |
|---|---|---|
| `/` | redirect to `/my` | WB-1 |
| `/setup`, `/login` | initial setup, login (no layout) | WB-3 |
| `/profile` | profile | WB-3 |
| `/inbox`, `/my` | Inbox, "My tasks" | WB-9 |
| `/p/:projectId/:view?` | project; `view` = `list` (default) \| `board` \| module view id | WB-4, WB-5 |
| `/p/:projectId/v/:viewId` | saved view | WB-8 |
| `/t/:key` | task by key `PLN-123` or by id | WB-6 |
| `/settings/:section?` | settings | WB-10 |
| `/m/:moduleId/*` | module routes | modules |
| `/dev/ui` | C-ui component showcase; the route is declared only under `import.meta.env.DEV`, absent in the production build | DS-0 |

Route names match the first segment (`inbox`, `my`, `project`, `savedView`, `task`, `settings`, `login`, `setup`, `profile`). Screens load lazily (`() => import(...)`) to stay within the bundle budget.

### Extension points (C-modules, web side)
`EXTENSION_KINDS = ['routes', 'views', 'taskPanels', 'commands', 'fieldTypes', 'settings', 'nav', 'topbar', 'search', 'groupTabs'] as const` - exactly the fields of `FrontendModuleManifest` (core, C-modules) except `id`.
`nav`, `topbar` - C-modules v3 (work), docs/contracts/work.md §C-modules v3; `search` - C-ui v2.

```ts
type Lazy<P> = () => Promise<{ default: Component }>; // component with props P
interface WebModuleManifest extends FrontendModuleManifest {
  routes?: RouteRecordRaw[];        // paths only under /m/<id>/
  views?: ViewDef[];
  taskPanels?: TaskPanelDef[];
  commands?: CommandDef[];
  fieldTypes?: FieldTypeDef[];
  settings?: SettingsPageDef[];
}
interface ViewDef { id: string; label: LocalizedText; icon: Component; component: Lazy<{ projectId: string; viewId?: string }> }
interface TaskPanelDef { id: string; label: LocalizedText; icon?: Component; order?: number; component: Lazy<{ taskId: string }> }
interface CommandCtx { route: RouteLocationNormalizedLoaded; selectedTaskIds: string[]; projectId?: string }
interface CommandDef { id: string; label: LocalizedText; icon?: Component; shortcut?: string; group?: LocalizedText;
  when?: (ctx: CommandCtx) => boolean; run: (ctx: CommandCtx) => void | Promise<void> }
interface FieldTypeDef { id: string; label: LocalizedText;
  cell: Lazy<{ value: unknown }>; editor: Lazy<{ value: unknown; 'onUpdate:value': (v: unknown) => void }> }
interface SettingsPageDef { id: string; label: LocalizedText; icon?: Component; component: Lazy<{}> }
```
- `defineWebModule(m: WebModuleManifest): WebModuleManifest` - returns its argument as is (for types). A module writes it in `modules/<id>/web/index.ts`: `export const web = defineWebModule({...})`; import - `@planar/web/modules` (`exports["./modules"]` in `apps/web/package.json` -> `./src/modules/types.ts`).
- An item's `id` is unique within a module; the global key is `<moduleId>:<id>`. A duplicate key or a route outside `/m/<id>/` -> `registerModules` throws `Error`.
- `useExtensions(kind)` -> `ComputedRef<items[]>` of enabled modules only (`settings.enabled_modules`; until WB-10 - all registered), `taskPanels` - by `order`, then by key.
- `TaskPanelDef.card?: boolean` (PLANARAPP-43): the panel component (props `{ taskId }`) is also rendered on every task card of the Board and the mobile List and at the end of the desktop List row, always visible, where the module is enabled for the task's project (`useCardExtensions` in `apps/web/src/views/cardExtensions.ts`).
- Modules load lazily: `import.meta.glob('../../../../modules/*/web/index.ts')` from `apps/web/src/modules/registry.ts` (WB-10); not part of the initial chunk.
