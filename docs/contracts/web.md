---
type: contract
status: active
module: web
updated: 2026-10-22
summary: Контракты web — C-ui (токены, компоненты, i18n, маршруты, точки расширения) и C-client (клиент синхронизации)
related: ["docs/plan/web.md", "docs/contracts/core.md", "docs/roadmap.md"]
contracts: [{"id": "C-ui", "version": 1}, {"id": "C-client", "version": 1}]
---

# Контракты модуля web

Владелец — координатор web. Потребители — задачи WB-*, модули `modules/*/web` (FT-*). Менять — только координатор: версия +1 в заголовке и в `apps/web/src/contract.ts`, правка контрактного теста.

**Контрактный тест** — `apps/web/src/__contract__/ui.contract.test.ts` (пишет координатор, исполнитель не правит). Проверяет: версию из заголовка `## C-ui vN` = `UI_CONTRACT_VERSIONS` из `apps/web/src/contract.ts`; каждый токен из таблиц ниже объявлен в `tokens.css` в светлом и в тёмном блоке; каждый компонент из списка экспортирован из `apps/web/src/ui/index.ts`; `EXTENSION_KINDS` = список точек расширения ниже. Запуск: `pnpm --filter web test`.

## C-ui v1

### Файлы
| Путь | Что |
|---|---|
| `apps/web/src/contract.ts` | `export const UI_CONTRACT_VERSIONS = { 'C-ui': 1, 'C-client': 1 } as const;` |
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

## C-client v1

Клиент синхронизации — `apps/web/src/sync/index.ts` (владелец WB-2; потребители — WB-3…WB-10, модули). Протокол с сервером — C-sync (core), мутаторы — C-mutators. Контрактный тест — `apps/web/src/__contract__/client.contract.test.ts` (экспорты ниже).

### Экспорты
| Имя | Сигнатура | Поведение |
|---|---|---|
| `db` | `PlanarDB` (Dexie) | таблица на каждую сущность `ENTITIES` и сущности модулей, имя = имя сущности C-schema, ключ `id`, индексы = `meta.indexes`; служебные `_meta` (`clientId`, `cursor`, `lastMutationId`), `_queue` (`{id: number, name, args, createdAt}`) |
| `startSync` | `(opts: {userId: string; baseUrl?: string; fetch?: typeof fetch; WebSocket?: typeof WebSocket}) => Promise<void>` | тёплый старт: реплика есть — промис сразу после открытия базы, затем pull; нет — bootstrap; дальше WS |
| `stopSync` | `() => Promise<void>` | закрывает WS, таймеры; база остаётся |
| `useQuery` | `<T>(fn: () => T \| Promise<T>) => Readonly<Ref<T \| undefined>>` | liveQuery → ref; пересчёт при изменении прочитанных таблиц; отписка при уничтожении scope; `fn` читает `db` |
| `mutate` | `(name: string, args: unknown) => Promise<void>` | неизвестное имя → `MutatorError('invalid_args')`; args по zod мутатора (ошибка → `invalid_args`, в очередь не попадает); применяет `run` к реплике в одной транзакции Dexie с записью в `_queue`; промис — после локального применения, не после сервера |
| `registerMutators` | `(defs: MutatorDef[]) => void` | дубликат имени → `Error` |
| `syncState` | `Readonly<Ref<{status: 'idle'\|'bootstrapping'\|'online'\|'offline'\|'error'; pending: number}>>` | `pending` — длина `_queue` |
| `onMutationError` | `(cb: (e: {id: number; name: string; code: string; message: string}) => void) => () => void` | отклонённая сервером мутация (уже откатана rebase) |
| `onUnauthorized` | `(cb: () => void) => () => void` | `401` или WS-закрытие 4401; переход на вход делает вызывающий |
| `newId` | `() => string` | `uuidv7()` из `@planar/shared` |
| `rankBetween` | `(a: string \| null, b: string \| null) => string` | `generateKeyBetween` из `fractional-indexing` |

### Инварианты
- `ctx` мутатора на клиенте: `{userId: opts.userId из startSync, now: new Date().toISOString(), server: false}`.
- Rebase после каждого pull: применить `changes` по `seq`, выкинуть из `_queue` мутации с `id ≤ lastMutationId`, остальные заново применить поверх серверного состояния. Реплика без неподтверждённых мутаций = серверное состояние.
- `reset` (C-sync) → очистка таблиц сущностей, bootstrap, затем rebase очереди.
- Очередь живёт в IndexedDB и переживает перезагрузку; push пачками ≤ 100, повтор при сети/`5xx` с паузой 1–30 с.
- Клиентский `Tx` над Dexie проходит набор `txContractSuite` (`packages/shared/test/tx-contract.ts`).
