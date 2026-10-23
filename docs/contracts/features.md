---
type: contract
status: active
module: features
updated: 2026-10-23
summary: Контракты features — пользовательские поля, связи задач, фильтры по полям, виды «Таблица» и «Календарь»
related: ["docs/plan/features.md", "docs/contracts/core.md", "docs/contracts/core-mutators.md", "docs/contracts/web.md"]
contracts: [{"id": "F-fields", "version": 1}, {"id": "F-links", "version": 1}, {"id": "F-filter", "version": 1}, {"id": "F-views", "version": 1}]
---

# Контракты модуля features

Владелец — координатор features. Сущности `fieldDefs`, `taskLinks` и формат `tasks.fields` — в `docs/contracts/core.md` (C-schema v6), мутаторы — `docs/contracts/core-mutators.md` (C-mutators v3), REST/MCP — `docs/contracts/core-api-v1.md` (C-http v8); их сверяют контрактные тесты core (`packages/shared/test/contract.test.ts`, `check-mutators.ts`, `apps/api/test/contract.schema.test.ts`). Здесь — то, что они не покрывают. Web-контракты (C-client, C-tasks, C-views) не меняем: только расширяем точками ниже.

## F-fields v1

### Значения в `tasks.fields`
Ключ — `fieldDefs.id`; значение никогда не `null` (пустое — ключа нет).

| type | значение | options |
|---|---|---|
| `text` | строка 1–5000 символов | `{}` |
| `number` | конечное число | `{}` |
| `date` | `YYYY-MM-DD` | `{}` |
| `select` | `id` одного из `options.choices` | `{choices: {id: string 1–36, label: string 1–100, color?: string}[]}`, id уникальны |
| `user` | uuid пользователя (строка `users` есть) | `{}` |
| `url` | `http://` или `https://` URL, ≤ 2048 символов | `{}` |
| `money` | целое число в минимальных единицах (копейки, центы), \|v\| ≤ `Number.MAX_SAFE_INTEGER` | `{currency: /^[A-Z]{3}$/}` (ISO 4217), по умолчанию `RUB` |

### Экспорты shared (`@planar/shared`, без Node API)
| Имя | Сигнатура | Поведение |
|---|---|---|
| `FIELD_TYPES` | `readonly ['text','number','date','select','user','url','money']` | порядок — для меню выбора типа |
| `FieldType` | тип `(typeof FIELD_TYPES)[number]` | |
| `fieldOptionsSchema` | `(type: FieldType) => ZodType` | схема `options` по таблице |
| `defaultFieldOptions` | `(type: FieldType) => Record<string, unknown>` | `select` — `{choices: []}`, `money` — `{currency: 'RUB'}`, иначе `{}` |
| `fieldValueSchema` | `(def: {type: FieldType; options: Record<string, unknown>}) => ZodType` | схема значения по таблице (существование пользователя проверяет мутатор) |

### Инварианты
- Ключ без определения в проекте задачи не пишется (`invalid_args`); читатели (виды, REST, MCP) ключ без определения пропускают.
- `field.delete` и удаление варианта `select` чистят значения в задачах проекта; смена проекта задачи обнуляет `fields`.
- Деньги показываются `Intl.NumberFormat(locale, {style: 'currency', currency}).format(v / 100)`; ввод — с точкой или запятой, хранится `Math.round(x * 100)`.

### Web (`apps/web/src/fields/index.ts`, FT-1b)
| Имя | Сигнатура | Поведение |
|---|---|---|
| `useFieldDefs` | `(projectId: MaybeRefOrGetter<string>) => Readonly<Ref<Row<'fieldDefs'>[] \| undefined>>` | индекс `projectId`, по `rank` |
| `setTaskField` | `(taskId: string, fieldId: string, value: unknown) => Promise<void>` | `mutate('task.setField', …)`; `null` — убрать |
| `formatFieldValue` | `(def: Row<'fieldDefs'>, value: unknown, ctx: {locale: string; users: Row<'users'>[]}) => string` | чистая; нет значения или вариант удалён — `''` |
| `FieldCell` | SFC: `def`, `value` | показ значения в строке/ячейке (только чтение) |
| `FieldEditor` | SFC: `def`, `value`, `spaceId`, событие `update:value` (`unknown \| null`) | редактор по типу; `null` — очистить; неверный ввод не эмитится |

## F-links v1

### Направления
Строка `taskLinks` `{taskId: A, targetId: B, kind}` видна с двух сторон:

| kind | со стороны A (`taskId`) | со стороны B (`targetId`) |
|---|---|---|
| `blocks` | `blocks` — блокирует B | `blockedBy` — заблокирована A |
| `relates` | `relates` | `relates` |
| `duplicates` | `duplicates` — дубликат B | `duplicatedBy` — B дублирует её |

`LinkSide = 'blocks' | 'blockedBy' | 'relates' | 'duplicates' | 'duplicatedBy'`. Задача **заблокирована**, если есть строка `blocks` с `targetId` = она, а блокирующая задача не завершена (`completedAt = null`).

### Web (`apps/web/src/links/index.ts`, FT-4a)
| Имя | Сигнатура | Поведение |
|---|---|---|
| `useTaskLinks` | `(taskId: MaybeRefOrGetter<string>) => Readonly<Ref<{id: string; side: LinkSide; otherId: string}[] \| undefined>>` | индексы `taskId` и `targetId`; по `side` в порядке типа, затем `otherId` |
| `useBlockedIds` | `(projectId: MaybeRefOrGetter<string>) => Readonly<Ref<ReadonlySet<string>>>` | id задач проекта, которые заблокированы (определение выше); пустое множество, пока не прочитано |
| `linkTasks` | `(taskId: string, otherId: string, side: LinkSide) => Promise<string>` | `blockedBy`/`duplicatedBy` — меняет местами задачи и пишет `blocks`/`duplicates`; `link.create` с новым id; возвращает id |
| `unlinkTasks` | `(id: string) => Promise<void>` | `link.delete` |
| `BlockedIcon` | SFC без пропсов | иконка `lucide` `Ban` (или `OctagonX`) размера иконок строки, с `aria-label` из i18n `links.blocked` |

## F-filter v2 (расширение C-views `FilterRule`)

v2 (work, WK-0): `matchFilter` в `@planar/shared`, правило `cycle`, `ctx.cycles` — docs/contracts/work.md §F-filter v2.
- `FilterRule.field` дополнительно — `` `field:${fieldId}` ``; `value` дополнительно — `number`.
- Операторы по типу поля: `text`, `url` — `contains`, `isEmpty`, `isNotEmpty`; `number`, `money` — `gte`, `lte` (`value: number`; у `money` — в минимальных единицах), `isEmpty`, `isNotEmpty`; `date` — `before`, `after` (`YYYY-MM-DD`, `today±N` как у `dueDate`), `isEmpty`, `isNotEmpty`; `select` — `in`, `notIn` (id вариантов), `isEmpty`, `isNotEmpty`; `user` — `in`, `notIn` (uuid или `'me'`), `isEmpty`, `isNotEmpty`.
- `isEmpty` — ключа нет в `fields`. Правило по полю без определения (удалено) — пропускается (считается выполненным). Операторы `gte`/`lte` допустимы только для `field:` правил.
- `matchFilter` (`apps/web/src/views/filter.ts`) получает в `ctx` необязательное `fieldDefs?: Row<'fieldDefs'>[]`; без него все `field:` правила пропускаются. Сигнатура остальных аргументов не меняется.

## F-views v2

v2 (work, WK-7): раскладка Таблицы в `savedViews.config.columns`, первый день недели Календаря — work.md §F-views v2.
- Встроенные виды `table` (FT-2) и `calendar` (FT-3) — `apps/web/src/views/table/View.vue`, `apps/web/src/views/calendar/View.vue`, пропсы `ViewProps` (C-views); показывают только задачи, где `matchFilter` = true. Вкладки находит существующий glob; иконки и порядок — `BUILTIN`/`ORDER` в `apps/web/src/views/index.ts`: `table: Table2`, `calendar: CalendarDays`, `ORDER = ['list', 'board', 'table', 'calendar']`; подписи — i18n `views.table` («Таблица»/«Table»), `views.calendar` («Календарь»/«Calendar»). Их правит FT-3 за оба вида.
- `savedViews.layout` — `table` или `calendar`, как любой встроенный вид.
- Таблица: колонки — системные `title`, `key`, `status`, `assignee`, `priority`, `dueDate`, `startDate`, `labels`, `createdAt`, `updatedAt` и `field:<fieldId>`; раскладка `{columns: {id: string; width: number}[]}` (порядок = порядок массива, ширина в px 60–800) — `localStorage['planar.table.<projectId>']` (try/catch, неизвестные id пропускаются). Правка — только мутаторами: системные поля через `updateTask`/`setAssignees`/`setLabels` (C-tasks), пользовательские — `setTaskField`.
- Календарь: режим `month` | `week` — `localStorage['planar.calendar.<projectId>']`; неделя с понедельника. Задача показывается от `startDate` до `dueDate`; есть одна дата — в этот день; нет обеих — в боковой колонке «Без даты». Перетаскивание на день сдвигает обе даты на одну разницу (длительность сохраняется), из боковой колонки — ставит `dueDate`; одна мутация `updateTask` на задачу. Mobile (`useBreakpoint().isMobile`) — список по дням.
- Даты — календарные `YYYY-MM-DD` без часового пояса. «Сегодня» — `localToday()` из `apps/web/src/views/filter.ts`. Дата из `Date` — только по локальным компонентам (`getFullYear/getMonth/getDate`), не `toISOString()`; сложение дней — через `new Date(y, m, d + n)`.
