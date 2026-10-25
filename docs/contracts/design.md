---
type: contract
status: active
module: design
updated: 2026-10-24
summary: Контракт C-ui v4 — токены, контраст, плотность, базовые компоненты, маршруты и точки расширения web
related: ["docs/plan/design.md", "docs/contracts/web.md", "docs/contracts/work.md", "docs/roadmap.md"]
contracts: [{"id": "C-ui", "version": 4}]
---

# Контракт C-ui (интерфейс web)

Владелец — координатор design (до фазы 3 — координатор web). Потребители — web (`apps/web`), все `modules/*/web`, модуль `p3`. Менять — только координатор: версия +1 в заголовке и в `apps/web/src/contract.ts`, правка контрактного теста, уведомление потребителей.

**Контрактный тест** — `apps/web/src/__contract__/ui.contract.test.ts` (пишет координатор, исполнитель не правит). Проверяет: версию из заголовка `## C-ui vN` (здесь) и заголовки `## C-… vN` из `docs/contracts/web.md` = `UI_CONTRACT_VERSIONS` из `apps/web/src/contract.ts`; каждый токен цвета объявлен в `tokens.css` в светлом и в тёмном блоке, размеры — в `@theme`; пары из «Контраст» не ниже порога в обеих темах; каждый компонент из списка экспортирован из `apps/web/src/ui/index.ts`; `EXTENSION_KINDS` = список точек расширения ниже. Запуск: `pnpm --filter web test`.

## C-ui v4

v4 (design, DS-0b): `Menu` без слота `trigger` рисует сам `IconButton` «…» (`MoreHorizontal`) с подписью `label` — модулям без зависимости `lucide-vue-next` не нужны свои иконки; `Input` передаёт атрибуты (`required`, `maxlength`, `name`, `autocomplete`, `data-*`) на `<input>`, а не на обёртку. Совместимо с v3.

v3 (design, DS-0): визуал «плотно и строго, как Linear» (`docs/plan/design.md` §4). Нейтральная шкала, токены боковой панели, тени, шкала шрифта 11–20 px с базой 13 px, проверка контраста, новые компоненты (IconButton, ConfirmDialog, Tabs, Chip, AvatarStack, Kbd, EmptyState, Toolbar), правила плотности и деструктивных действий, витрина `/dev/ui`. Совместимо с v2: пропсы и события v2 сохраняются, значения токенов и вид компонентов меняются. Вариант `Button` `danger` — только для кнопки подтверждения в `ConfirmDialog`; прочие его вызовы переводит DS-4.
v2 (collab, CL-1a): точка расширения `search` (`EXTENSION_KINDS` += `search`) — `docs/contracts/collab.md` §X-core п. 5; Inbox показывает уведомления без задачи по `body` и ведёт на `url`.

Модули (`modules/<id>/web/`) импортируют web только из SDK `@planar/web/modules` (`docs/contracts/work.md` §C-modules v4); прямой импорт `@planar/web/<путь>` запрещён (временный `exports["./*"]` из CL-4 убирает CL-6). Тесты модулей — `modules/*/web/**/*.test.ts`, их запускает проект web (`apps/web/vitest.config.ts`). Всё из `apps/web/src/ui/index.ts` попадает в SDK через `export * from '../ui'` в `apps/web/src/modules/sdk.ts` (добавление аддитивно, перечень C-modules не меняется).

### Файлы
| Путь | Что |
|---|---|
| `apps/web/src/contract.ts` | `export const UI_CONTRACT_VERSIONS = { 'C-ui': 4, 'C-client': 4, 'C-tasks': 3, 'C-views': 2 } as const;` |
| `apps/web/src/ui/tokens.css` | токены: блок `@theme { … }` — светлая тема и общие размеры, блок `.dark { … }` — тёмная (те же имена цветов) |
| `apps/web/src/ui/index.ts` | экспорт компонентов и `useBreakpoint`, `useTheme` |
| `apps/web/src/styles.css` | база: `body` — `font-size: var(--text-sm)` (13 px), `line-height: var(--text-sm--line-height)` |
| `apps/web/src/screens/DevUiScreen.vue` | витрина `/dev/ui`: все компоненты и варианты, переключатель темы; только в dev |
| `apps/web/src/i18n/{index,ru,en}.ts` | vue-i18n, словари; строки компонентов — ключи `ui.*` |
| `apps/web/src/modules/types.ts` | типы точек расширения, `EXTENSION_KINDS`, `defineWebModule` |
| `apps/web/src/modules/registry.ts` | `registerModules(manifests)`, `useExtensions(kind)` |

### Токены цвета
Tailwind 4: имена в `@theme` дают утилиты (`--color-bg` → `bg-bg`, `text-fg`, `border-border`). В компонентах — только эти утилиты или `var(--color-…)`; литералы цветов запрещены (кроме значения `color` из данных: статусы, метки). Значение токена — `#rrggbb` или `var(--color-…)` другого токена (так их читает проверка контраста).

Нейтральная шкала — 10 ступеней по роли, а не по светлоте: в светлой теме 1 — самая светлая, в тёмной — самая тёмная. Семантические токены ссылаются на шкалу или задаются своим значением.

| Токен | Назначение |
|---|---|
| `--color-neutral-1` | фон приложения |
| `--color-neutral-2` | приподнятый фон (шапки групп, панели) |
| `--color-neutral-3` | hover |
| `--color-neutral-4` | нажатое, выбранное нейтральное |
| `--color-neutral-5` | граница |
| `--color-neutral-6` | граница полей, сильная граница |
| `--color-neutral-7` | неактивное, декоративные иконки (не текст) |
| `--color-neutral-8` | третичный текст, плейсхолдеры |
| `--color-neutral-9` | вторичный текст |
| `--color-neutral-10` | основной текст |
| `--color-bg` | фон приложения |
| `--color-bg-subtle` | фон шапок групп, панелей |
| `--color-bg-muted` | hover строк, неактивные поля |
| `--color-surface` | поповеры, диалоги, карточки доски |
| `--color-overlay` | подложка под диалогом (может быть `#rrggbbaa`; в проверке контраста не участвует) |
| `--color-border` | обычная граница |
| `--color-border-strong` | граница полей ввода |
| `--color-fg` | основной текст |
| `--color-fg-muted` | вторичный текст |
| `--color-fg-subtle` | подсказки, плейсхолдеры, иконки |
| `--color-accent` | основное действие, выбранное, ссылки (единственный акцент) |
| `--color-accent-fg` | текст на `accent` |
| `--color-accent-subtle` | фон выбранной строки |
| `--color-danger` | опасное действие, ошибка (текст `danger-ghost`) |
| `--color-danger-fg` | текст на `danger` |
| `--color-danger-subtle` | hover опасного пункта меню и `danger-ghost` |
| `--color-warning` | предупреждение, срок скоро |
| `--color-success` | успех |
| `--color-focus` | кольцо фокуса (`focus-visible`, 2px) |
| `--color-sidebar-bg` | фон боковой панели (тёмный в обеих темах) |
| `--color-sidebar-fg` | основной текст боковой панели |
| `--color-sidebar-fg-muted` | вторичный текст, иконки, заголовки групп боковой панели |
| `--color-sidebar-hover` | hover элемента боковой панели |
| `--color-sidebar-active` | выбранный элемент боковой панели |
| `--color-sidebar-border` | разделители боковой панели |
| `--color-priority-urgent` | приоритет 1 |
| `--color-priority-high` | приоритет 2 |
| `--color-priority-medium` | приоритет 3 |
| `--color-priority-low` | приоритет 4 |

### Контраст
Контраст по WCAG 2.1 (относительная яркость sRGB), в обеих темах (тёмная — значения из `.dark`, недостающие ссылки — из `@theme`). Проверяет контрактный тест по `tokens.css`.

| Текст | Фон | Не ниже |
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

### Тема
- `useTheme()` → `{ theme: Ref<'system'|'light'|'dark'>, resolved: Ref<'light'|'dark'> }`; хранение — `localStorage['planar.theme']`, по умолчанию `system` (следит за `prefers-color-scheme`).
- Тёмная — класс `dark` на `<html>`; в Tailwind — `@custom-variant dark (&:where(.dark, .dark *));`. Класс ставится до монтирования (скрипт в `index.html`), без мигания.

### Шрифты, отступы, размеры
База — 13 px (`text-sm`, задан на `body`). Шкала 11/12/13/14/16/20: `text-2xs` — счётчики, `Kbd`, мелкие бейджи; `text-xs` — вторичный текст, ID, подписи; `text-sm` — основной текст, строки, кнопки, поля; `text-base` — заголовки диалогов, поля на mobile; `text-lg` — заголовки разделов, описание задачи; `text-xl` — заголовок страницы и задачи. Межстрочный интервал задан к каждому размеру (`--text-*--line-height`). Веса — 400 и 500 (заголовки — 600).

| Токен | Значение |
|---|---|
| `--font-sans` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` (без веб-шрифтов) |
| `--font-mono` | `ui-monospace, SFMono-Regular, Menlo, monospace` — ID задач (`PLN-123`), `Kbd`, код |
| `--text-2xs` | 11px |
| `--text-2xs--line-height` | 16px |
| `--text-xs` | 12px |
| `--text-xs--line-height` | 16px |
| `--text-sm` | 13px (база) |
| `--text-sm--line-height` | 20px |
| `--text-base` | 14px |
| `--text-base--line-height` | 20px |
| `--text-lg` | 16px |
| `--text-lg--line-height` | 24px |
| `--text-xl` | 20px |
| `--text-xl--line-height` | 28px |
| `--radius-sm` | 4px — чипы, бейджи, `Kbd`, чекбоксы |
| `--radius-md` | 6px — кнопки, поля, пункты меню |
| `--radius-lg` | 8px — поповеры, диалоги, карточки доски |
| `--shadow-popover` | тень поповера, меню, выпадающего списка, подсказки |
| `--shadow-dialog` | тень диалога |

Тени — только у всплывающих элементов (`Popover`, `Menu`, `Select`, `Tooltip`, `Dialog`); у кнопок, полей, строк и карточек доски — граница, без тени.

### Плотность
Отступы — шкала Tailwind по умолчанию (`--spacing: 0.25rem`, шаг 4 px); значения вне шага 4 px — запрещены (кроме 2 px внутри `Kbd`, `Badge`, `Chip`).

| Элемент | Высота | Класс |
|---|---|---|
| строка списка | 32 px | `h-8` |
| элемент боковой панели | 28 px | `h-7` |
| кнопка, поле, выпадающий список `sm` / `md` | 28 / 32 px | `h-7` / `h-8` |
| `IconButton` `sm` / `md` | 28 / 32 px, квадрат | `size-7` / `size-8` |
| `Chip`, `Badge` | 20 px | `h-5` |
| `Toolbar` | 44 px | `h-11` |
| пункт меню | 32 px | `h-8` |

На mobile (< 768 px) интерактивные цели ≥ 44 px (`min-h-11`/`min-w-11` у кнопок, полей, пунктов меню).

### Правила
- **Деструктивные действия** — пункт меню «…» (`Menu`, `MenuItem.danger` + `MenuItem.confirm`) с подтверждением в `ConfirmDialog`; сплошной красной кнопки в списках и строках нет.
- **Пустые значения** в строках и карточках не показываются: ни «—», ни иконки-заглушки (срока нет — нет и иконки календаря).
- **Вторичные действия** — по наведению: родитель `group`, действие `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`; на mobile (нет hover) — видимы всегда или в меню «…».
- **ID** задач — `font-mono text-xs text-fg-muted`.
- **Иконка-кнопка без текста** — только `IconButton` (подпись обязательна, она же `aria-label` и подсказка).
- **Фокус** — `focus-visible:outline-2 outline-focus` у всех интерактивных элементов.

### Брейкпоинт
Mobile — ширина < 768px (`md` Tailwind = 768px, стили mobile-first). В коде — `useBreakpoint()` → `{ isMobile: Ref<boolean> }` по `matchMedia('(max-width: 767.98px)')`.

На mobile (DS-5a, поведение без смены пропсов): `Popover`, `Menu`, `Select` открываются листом снизу (на всю ширину, радиус `lg` сверху, подложка `overlay`, закрытие по подложке и Esc); `Dialog` — на весь экран; `Tooltip` не показывается.

### Базовые компоненты (`apps/web/src/ui/index.ts`)
C-modules v10: `IconButton`, `ConfirmDialog`, `Tabs`, `Chip`, `AvatarStack`, `Kbd`, `EmptyState`, `Toolbar` входят в обязательный перечень SDK (`docs/contracts/work-api.md`, блок `sdk-exports=required`; тест `apps/web/src/__contract__/sdk.contract.test.ts`).

На Reka UI + Tailwind 4, SFC `<script setup lang="ts">`. Пользовательских строк внутри нет, кроме ключей `ui.*` через `t()` (подписи по умолчанию); остальные подписи приходят пропсами. Пропсы и события v2 сохраняются.

| Компонент | Пропсы и события | Поведение |
|---|---|---|
| `Button` | `variant: 'primary'\|'secondary'\|'ghost'\|'danger-ghost'\|'danger'` = `secondary`; `size: 'sm'\|'md'` = `md`; `icon?: Component`; `iconRight?: Component`; `loading?`, `disabled?`; `type` = `button`; слот default | высота 28/32 px; `danger-ghost` — текст `danger`, без фона, hover `danger-subtle`; `danger` (сплошная) — только в `ConfirmDialog`; `loading` → `aria-busy`, кнопка неактивна |
| `IconButton` | `icon: Component` (обязателен); `label: string` (обязателен); `variant: 'ghost'\|'secondary'` = `ghost`; `size: 'sm'\|'md'` = `md`; `shortcut?: string`; `active?: boolean`; `disabled?`; событие `click` | квадрат 28/32 px; `label` → `aria-label` и `Tooltip` (с `shortcut`); `active` → `aria-pressed="true"` и фон `bg-muted` |
| `Input` | `v-model: string`; `label: string` (обязателен); `hideLabel?`; `type?`, `placeholder?`, `error?: string`, `disabled?`; `size: 'sm'\|'md'` = `md`; `icon?: Component` (слева) | `error` → `aria-invalid` и текст под полем; прочие атрибуты (`required`, `maxlength`, `name`, `autocomplete`, `data-*`) — на `<input>`; `class` — на обёртку |
| `Select` | `v-model: string\|null`; `options: {value: string, label: string, icon?: Component, color?: string}[]`; `label: string`; `placeholder?`, `disabled?`; `size: 'sm'\|'md'` = `md` | клавиатура Reka; `color` — точка 8 px перед подписью |
| `Menu` | `items: MenuItem[]`; `side?`, `align?` = `start`; слот `trigger`; `label?: string` (обязателен без слота `trigger`) | без слота `trigger` — `IconButton` с иконкой `MoreHorizontal`, `label` → `aria-label` и подсказка; `MenuItem = {id, label, icon?, shortcut?, danger?, disabled?, confirm?: {title: string, description?: string, confirmLabel: string}, onSelect: () => void} \| {separator: true}`; `danger` — текст `danger`, hover `danger-subtle`; `confirm` задан → выбор открывает `ConfirmDialog`, `onSelect` — только после подтверждения; `shortcut` — `Kbd` справа |
| `Popover` | `v-model:open`; `side?`, `align?`; слоты `trigger`, default | тень `shadow-popover`, радиус `lg` |
| `Dialog` | `v-model:open`; `title: string` (обязателен); `description?`; `size: 'sm'\|'md'\|'lg'` = `md` (ширина 400/560/720 px); слоты default, `footer` | на mobile — на весь экран; Esc закрывает; подложка `overlay`, тень `shadow-dialog` |
| `ConfirmDialog` | `v-model:open`; `title: string` (обязателен); `description?`; `confirmLabel: string` (обязателен); `cancelLabel?` = `t('ui.cancel')`; `danger?: boolean` = `true`; событие `confirm` | `Dialog` `size="sm"`; кнопки «отмена» (`ghost`) и подтверждение (`danger` или `primary`); фокус при открытии — на «отмене»; подтверждение → `confirm`, затем закрытие; Esc и «отмена» — закрытие без `confirm` |
| `Tabs` | `v-model: string`; `items: {value: string, label: string, icon?: Component, count?: number}[]`; `label: string` (обязателен, `aria-label` списка); `size: 'sm'\|'md'` = `sm` | `role="tablist"`/`tab`, `aria-selected`; стрелки ←/→ переводят фокус, Enter/Space выбирают; выбранная — фон `bg-muted`, текст `fg`; остальные — `fg-muted`; не переносятся, при переполнении — горизонтальная прокрутка |
| `Chip` | `color?: string` (точка); `icon?: Component`; `removable?: boolean`; `removeLabel?: string` (обязателен при `removable`); событие `remove`; слот default | высота 20 px, радиус `sm`, фон `bg-muted`; крестик — кнопка с `aria-label=removeLabel` |
| `Avatar` | `name: string`; `src?: string\|null`; `size: 'xs'\|'sm'\|'md'\|'lg'` = 16/20/24/32px | без `src` — инициалы, цвет фона от хэша `name` |
| `AvatarStack` | `people: {name: string, src?: string\|null}[]`; `max?: number` = 3; `size: 'xs'\|'sm'` = `sm` | аватары внахлёст (−4 px) с обводкой цвета фона; больше `max` — последний кружок `+N`; `title` — имена через запятую; пустой список — ничего не рендерит |
| `Badge` | `variant: 'solid'\|'soft'\|'outline'` = `soft`; `color?: string`; `dot?: boolean`; слот default | `dot` — точка 8 px цвета `color` и текст `fg-muted` без фона (метки в строках) |
| `Kbd` | `keys: string` (`'Mod+K'`, `'Shift+Enter'`, `'G I'`) | `+` — одновременно, пробел — последовательно; `Mod` → `⌘` на macOS, `Ctrl` в остальных; каждая клавиша — `<kbd>`, `font-mono text-2xs`, граница `border`, радиус `sm` |
| `EmptyState` | `title: string` (обязателен); `description?`; `icon?: Component`; слот `actions` | по центру контейнера, отступ ≥ 48 px сверху, иконка 32 px `fg-subtle`, `title` — `text-base`, `description` — `text-sm fg-muted`, ширина текста ≤ 360 px |
| `Toolbar` | `label: string` (обязателен, `aria-label`); слоты default (слева), `end` (справа) | `role="toolbar"`, высота 44 px, граница снизу, промежутки 4 px; на mobile — одна строка с горизонтальной прокруткой без переноса |
| `Tooltip` | `content: string`; `shortcut?: string`; слот default (триггер) | задержка 400 мс; `shortcut` — через `Kbd`; тень `shadow-popover` |

### Иконки
Только `lucide-vue-next`, импорт поштучно (`import { Plus } from 'lucide-vue-next'`); размер 16 по умолчанию, в mobile-навигации 20. Других наборов и SVG-файлов иконок нет (кроме иконок PWA).

### i18n
vue-i18n, локали `ru`, `en`. Ключи вложенные: `<экран>.<элемент>` (`sidebar.inbox`). Начальная локаль — `localStorage['planar.locale']`, иначе `ru`, если `navigator.language` начинается с `ru`, иначе `en`. Отсутствующий ключ в `en` → берётся `ru` (fallback), в тестах — предупреждение.
`LocalizedText = string | { ru: string; en: string }`: строка — ключ словаря web, объект — готовый текст (так подписывают элементы модули, у которых своих словарей нет).

### Маршруты (WB-1 создаёт, экраны — заглушки до своих задач)
| Путь | Экран | Задача |
|---|---|---|
| `/` | редирект на `/my` | WB-1 |
| `/setup`, `/login` | первичная настройка, вход (без раскладки) | WB-3 |
| `/profile` | профиль | WB-3 |
| `/inbox`, `/my` | Inbox, «Мои задачи» | WB-9 |
| `/p/:projectId/:view?` | проект; `view` = `list` (по умолчанию) \| `board` \| id вида модуля | WB-4, WB-5 |
| `/p/:projectId/v/:viewId` | сохранённый вид | WB-8 |
| `/t/:key` | задача по ключу `PLN-123` или по id | WB-6 |
| `/settings/:section?` | настройки | WB-10 |
| `/m/:moduleId/*` | маршруты модулей | модули |
| `/dev/ui` | витрина компонентов C-ui; маршрут объявлен только при `import.meta.env.DEV`, в прод-сборке его нет | DS-0 |

Имена маршрутов совпадают с первым сегментом (`inbox`, `my`, `project`, `savedView`, `task`, `settings`, `login`, `setup`, `profile`). Экраны грузятся лениво (`() => import(...)`), чтобы держать бюджет бандла.

### Точки расширения (C-modules, сторона web)
`EXTENSION_KINDS = ['routes', 'views', 'taskPanels', 'commands', 'fieldTypes', 'settings', 'nav', 'topbar', 'search', 'groupTabs'] as const` — ровно поля `FrontendModuleManifest` (core, C-modules) кроме `id`.
`nav`, `topbar` — C-modules v3 (work), docs/contracts/work.md §C-modules v3; `search` — C-ui v2.

```ts
type Lazy<P> = () => Promise<{ default: Component }>; // компонент с пропсами P
interface WebModuleManifest extends FrontendModuleManifest {
  routes?: RouteRecordRaw[];        // пути только под /m/<id>/
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
- `defineWebModule(m: WebModuleManifest): WebModuleManifest` — возвращает как есть (для типов). Модуль пишет в `modules/<id>/web/index.ts`: `export const web = defineWebModule({...})`; импорт — `@planar/web/modules` (`exports["./modules"]` в `apps/web/package.json` → `./src/modules/types.ts`).
- `id` элемента уникален в модуле; глобальный ключ — `<moduleId>:<id>`. Дубликат ключа или маршрут вне `/m/<id>/` → `registerModules` бросает `Error`.
- `useExtensions(kind)` → `ComputedRef<элементы[]>` только включённых модулей (`settings.enabled_modules`; до WB-10 — все зарегистрированные), `taskPanels` — по `order`, затем по ключу.
- Модули подключаются лениво: `import.meta.glob('../../../../modules/*/web/index.ts')` из `apps/web/src/modules/registry.ts` (WB-10); в начальный чанк не входят.
