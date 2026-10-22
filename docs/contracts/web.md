---
type: contract
status: active
module: web
updated: 2026-10-22
summary: Контракт web C-ui — токены, шрифты, брейкпоинт, базовые компоненты, иконки, i18n, маршруты, точки расширения фронта (C-modules, сторона web)
related: ["docs/plan/web.md", "docs/contracts/core.md", "docs/roadmap.md"]
contracts: [{"id": "C-ui", "version": 1}]
---

# Контракты модуля web

Владелец — координатор web. Потребители — задачи WB-*, модули `modules/*/web` (FT-*). Менять — только координатор: версия +1 в заголовке и в `apps/web/src/contract.ts`, правка контрактного теста.

**Контрактный тест** — `apps/web/src/__contract__/ui.contract.test.ts` (пишет координатор, исполнитель не правит). Проверяет: версию из заголовка `## C-ui vN` = `UI_CONTRACT_VERSIONS` из `apps/web/src/contract.ts`; каждый токен из таблиц ниже объявлен в `tokens.css` в светлом и в тёмном блоке; каждый компонент из списка экспортирован из `apps/web/src/ui/index.ts`; `EXTENSION_KINDS` = список точек расширения ниже. Запуск: `pnpm --filter web test`.

## C-ui v1

### Файлы
| Путь | Что |
|---|---|
| `apps/web/src/contract.ts` | `export const UI_CONTRACT_VERSIONS = { 'C-ui': 1 } as const;` |
| `apps/web/src/ui/tokens.css` | токены: блок `@theme { … }` — светлая тема, блок `.dark { … }` — тёмная (те же имена) |
| `apps/web/src/ui/index.ts` | экспорт компонентов и `useBreakpoint`, `useTheme` |
| `apps/web/src/i18n/{index,ru,en}.ts` | vue-i18n, словари |
| `apps/web/src/modules/types.ts` | типы точек расширения, `EXTENSION_KINDS`, `defineWebModule` |
| `apps/web/src/modules/registry.ts` | `registerModules(manifests)`, `useExtensions(kind)` |

### Токены цвета
Tailwind 4: имена в `@theme` дают утилиты (`--color-bg` → `bg-bg`, `text-fg`, `border-border`). В компонентах — только эти утилиты или `var(--color-…)`; литералы цветов запрещены (кроме значения `color` из данных: статусы, метки).

| Токен | Назначение |
|---|---|
| `--color-bg` | фон приложения |
| `--color-bg-subtle` | фон боковой панели, шапок групп |
| `--color-bg-muted` | hover строк, неактивные поля |
| `--color-surface` | поповеры, диалоги, карточки доски |
| `--color-border` | обычная граница |
| `--color-border-strong` | граница полей ввода |
| `--color-fg` | основной текст |
| `--color-fg-muted` | вторичный текст |
| `--color-fg-subtle` | подсказки, плейсхолдеры, иконки |
| `--color-accent` | основное действие, выбранное |
| `--color-accent-fg` | текст на `accent` |
| `--color-accent-subtle` | фон выбранной строки |
| `--color-danger` | опасное действие, ошибка |
| `--color-danger-fg` | текст на `danger` |
| `--color-warning` | предупреждение, срок скоро |
| `--color-success` | успех |
| `--color-focus` | кольцо фокуса (`focus-visible`, 2px) |
| `--color-priority-urgent` | приоритет 1 |
| `--color-priority-high` | приоритет 2 |
| `--color-priority-medium` | приоритет 3 |
| `--color-priority-low` | приоритет 4 |

Контраст текста `fg`/`fg-muted` к `bg` — не ниже 4.5:1 в обеих темах.

### Тема
- `useTheme()` → `{ theme: Ref<'system'|'light'|'dark'>, resolved: Ref<'light'|'dark'> }`; хранение — `localStorage['planar.theme']`, по умолчанию `system` (следит за `prefers-color-scheme`).
- Тёмная — класс `dark` на `<html>`; в Tailwind — `@custom-variant dark (&:where(.dark, .dark *));`. Класс ставится до монтирования (скрипт в `index.html`), без мигания.

### Шрифты, отступы, размеры
| Токен | Значение |
|---|---|
| `--font-sans` | `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` (без веб-шрифтов) |
| `--font-mono` | `ui-monospace, SFMono-Regular, Menlo, monospace` |
| `--text-xs` | 12px |
| `--text-sm` | 13px |
| `--text-base` | 14px (основной) |
| `--text-lg` | 16px |
| `--text-xl` | 20px |
| `--radius-sm` | 4px |
| `--radius-md` | 6px |
| `--radius-lg` | 8px |

Отступы — шкала Tailwind по умолчанию (`--spacing: 0.25rem`, шаг 4px). Высота контролов: `sm` 28px, `md` 32px; на mobile интерактивные цели ≥ 44px.

### Брейкпоинт
Mobile — ширина < 768px (`md` Tailwind = 768px, стили mobile-first). В коде — `useBreakpoint()` → `{ isMobile: Ref<boolean> }` по `matchMedia('(max-width: 767.98px)')`.

### Базовые компоненты (`apps/web/src/ui/index.ts`)
На Reka UI + Tailwind 4, SFC `<script setup lang="ts">`. Пользовательских строк внутри нет (только через `t()`); подписи приходят пропсами.

| Компонент | Пропсы и события | Поведение |
|---|---|---|
| `Button` | `variant: 'primary'\|'secondary'\|'ghost'\|'danger'` = `secondary`; `size: 'sm'\|'md'` = `md`; `icon?: Component`; `loading?`, `disabled?`; `type` = `button`; слот default | только иконка → `aria-label` обязателен |
| `Input` | `v-model: string`; `label: string` (обязателен); `hideLabel?`; `type?`, `placeholder?`, `error?: string`, `disabled?` | `error` → `aria-invalid` и текст под полем |
| `Select` | `v-model: string\|null`; `options: {value: string, label: string, icon?: Component, color?: string}[]`; `label: string`; `placeholder?`, `disabled?` | клавиатура Reka |
| `Popover` | `v-model:open`; `side?`, `align?`; слоты `trigger`, default | |
| `Dialog` | `v-model:open`; `title: string` (обязателен); `description?`; слоты default, `footer` | на mobile — на весь экран; Esc закрывает |
| `Menu` | `items: MenuItem[]`; слот `trigger` | `MenuItem = {id, label, icon?, shortcut?, danger?, disabled?, onSelect: () => void} \| {separator: true}` |
| `Avatar` | `name: string`; `src?: string\|null`; `size: 'xs'\|'sm'\|'md'\|'lg'` = 16/20/24/32px | без `src` — инициалы, цвет фона от хэша `name` |
| `Badge` | `variant: 'solid'\|'soft'\|'outline'` = `soft`; `color?: string`; слот default | |
| `Tooltip` | `content: string`; `shortcut?: string`; слот default (триггер) | задержка 400 мс |

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

Имена маршрутов совпадают с первым сегментом (`inbox`, `my`, `project`, `savedView`, `task`, `settings`, `login`, `setup`, `profile`). Экраны грузятся лениво (`() => import(...)`), чтобы держать бюджет бандла.

### Точки расширения (C-modules, сторона web)
`EXTENSION_KINDS = ['routes', 'views', 'taskPanels', 'commands', 'fieldTypes', 'settings'] as const` — ровно поля `FrontendModuleManifest` (core, C-modules) кроме `id`.

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
