---
type: contract
status: active
module: web
updated: 2026-10-24
summary: Контракты web — C-client (синхронизация), C-tasks (слой задач), C-views (экран проекта и стык видов); C-ui — design.md
related: ["docs/plan/web.md", "docs/contracts/core.md", "docs/contracts/design.md", "docs/roadmap.md"]
contracts: [{"id": "C-client", "version": 4}, {"id": "C-tasks", "version": 3}, {"id": "C-views", "version": 2}]
---

# Контракты модуля web

Владелец — координатор web. Потребители — задачи WB-*, модули `modules/*/web` (FT-*). Менять — только координатор: версия +1 в заголовке и в `apps/web/src/contract.ts`, правка контрактного теста.

**C-ui** (токены, компоненты, маршруты, точки расширения) — `docs/contracts/design.md` (с фазы 3 владелец — координатор design).

Контрактные тесты — `apps/web/src/__contract__/*.contract.test.ts` (пишет координатор, исполнитель не правит). Запуск: `pnpm --filter web test`.

## C-client v4

v4 (collab, CL-1a): `sendTyping(entity: string, id: string): void` (нет WS — ничего), `onTyping(cb: (e: {entity: string; id: string; userId: string}) => void): () => void` — `docs/contracts/collab.md` §X-core п. 2.

Клиент синхронизации — `apps/web/src/sync/index.ts` (владелец WB-2; потребители — WB-3…WB-10, модули). Протокол с сервером — C-sync (core), мутаторы — C-mutators. Контрактный тест — `apps/web/src/__contract__/client.contract.test.ts` (экспорты ниже).

### Экспорты
| Имя | Сигнатура | Поведение |
|---|---|---|
| `db` | `PlanarDB` (Dexie) | таблица на каждую сущность `ENTITIES` и сущности модулей, имя = имя сущности C-schema, ключ `id`, индексы = `meta.indexes`; служебные `_meta` (`clientId`, `userId`, `cursor`, `lastMutationId`), `_queue` (`{id: number, name, args, createdAt}` + внутренние поля клиента; потребители `_meta` и `_queue` не читают) |
| `startSync` | `(opts: {userId: string; baseUrl?: string; fetch?: typeof fetch; WebSocket?: typeof WebSocket}) => Promise<void>` | тёплый старт: реплика есть — промис сразу после открытия базы, затем pull; нет — bootstrap; дальше WS. `_meta.userId` ≠ `opts.userId` → сначала `clearLocal()` (реплика другого пользователя не показывается) |
| `stopSync` | `() => Promise<void>` | закрывает WS, таймеры; база остаётся |
| `clearLocal` | `() => Promise<void>` | `stopSync`, затем очистка всех таблиц сущностей, `_queue` и `_meta` (новый `clientId`); вызывается при выходе |
| `useQuery` | `<T>(fn: () => T \| Promise<T>) => Readonly<Ref<T \| undefined>>` | liveQuery → `shallowRef` (значение не оборачивается в глубокий readonly-Proxy; результат не мутировать); пересчёт при изменении прочитанных таблиц; отписка при уничтожении scope; `fn` читает `db` |
| `mutate` | `(name: string, args: unknown) => Promise<void>` | неизвестное имя → `MutatorError('invalid_args')`; args по zod мутатора (ошибка → `invalid_args`, в очередь не попадает); применяет `run` к реплике в одной транзакции Dexie с записью в `_queue`; промис — после локального применения, не после сервера |
| `registerMutators` | `(defs: MutatorDef[]) => void` | дубликат имени → `Error` |
| `syncState` | `Readonly<Ref<{status: 'idle'\|'bootstrapping'\|'online'\|'offline'\|'error'; pending: number}>>` | `pending` — длина `_queue` |
| `onMutationError` | `(cb: (e: {id: number; name: string; code: string; message: string}) => void) => () => void` | отклонённая сервером мутация (уже откатана rebase) |
| `onUnauthorized` | `(cb: () => void) => () => void` | `401` или WS-закрытие 4401; переход на вход делает вызывающий |
| `onReplicaChange` | `(cb: (batch: { entity: string; id: string; row: Record<string, unknown> \| null }[]) => void) => () => void` | после каждой закоммиченной записи клиента в реплику (mutate, applyServer, rebase, bootstrap) — изменённые строки транзакции, `row: null` — удалена; порядок — порядок коммитов; в других вкладках — те же пачки через BroadcastChannel `planar-replica` (исключение: фоновые пачки bootstrap в другие вкладки не идут — по его завершении им приходит сброс `*`); `reset`/`clearLocal` — пачка `[{entity: '*', id: '*', row: null}]` (сбросить всё) |
| `replicaState` | `Readonly<Ref<'empty' \| 'partial' \| 'complete'>>` | `partial` — bootstrap записал открытый проект, остальное пишется фоном; курсор сохраняется только при `complete`; прерванный bootstrap начинается заново |
| `newId` | `() => string` | `uuidv7()` из `@planar/shared` |
| `rankBetween` | `(a: string \| null, b: string \| null) => string` | `generateKeyBetween` из `fractional-indexing` |

### Инварианты
- `ctx` мутатора на клиенте: `{userId: opts.userId из startSync, now: new Date().toISOString(), server: false}`.
- Rebase после каждого pull: применить `changes` по `seq`, выкинуть из `_queue` мутации с `id ≤ lastMutationId`, остальные заново применить поверх серверного состояния. Реплика без неподтверждённых мутаций = серверное состояние.
- `reset` (C-sync) → очистка таблиц сущностей, bootstrap, затем rebase очереди.
- Очередь живёт в IndexedDB и переживает перезагрузку; push пачками ≤ 100, повтор при сети/`5xx` с паузой 1–30 с.
- Клиентский `Tx` над Dexie проходит набор `txContractSuite` (`packages/shared/test/tx-contract.ts`).
- Все записи в таблицы сущностей реплики идут только через клиент синхронизации (иначе `onReplicaChange` не узнает о них).
- Цикл синхронизации: сначала push очереди, затем pull (push не зависит от курсора, C-sync).
- Bootstrap при пустой реплике: сначала строки открытого проекта (по маршруту `/p/:projectId` или `/t/:key`) и все сущности, кроме `tasks`/`taskAssignees`/`taskLabels`/`checklistItems`/`comments`/`attachments`/`commentReactions` других проектов, одной транзакцией → `replicaState = 'partial'`; остальное — пачками ≤ 1000 строк отдельными транзакциями с отдачей потока → `complete`, затем курсор.

## C-tasks v3

Общий слой задач для видов — `apps/web/src/tasks/index.ts` (владелец WB-2a; потребители WB-4…WB-10). Читает только реплику (C-client), пишет только через `mutate` доменных мутаторов (C-mutators); сеть не ждёт. Контрактный тест — `apps/web/src/__contract__/tasks.contract.test.ts`.

### Типы
- `TaskView = Row<'tasks'> & { key: string; assigneeIds: string[]; labelIds: string[] }`; `key` = `${project.key}-${number}`, при `number = null` — `${project.key}-…` (номер ещё не выдан сервером).
- `GroupBy = 'status' | 'assignee' | 'priority' | 'label'`; `SortBy = 'rank' | 'priority' | 'dueDate' | 'createdAt' | 'updatedAt' | 'title'`; `TaskGroup = { key: string; label: string; color?: string; tasks: TaskView[] }`.
- Аргументы запросов — `MaybeRefOrGetter` (vue), результат — `Readonly<Ref<…>>` из `useQuery`; `undefined` — ещё не прочитано.

### Экспорты
| Имя | Сигнатура | Поведение |
|---|---|---|
| `useSpaces` | `() => Ref<(Row<'spaces'> & { projects: Row<'projects'>[] })[]>` | по `rank`; архивные проекты не входят |
| `useProject` | `(id) => Ref<Row<'projects'> \| null \| undefined>` | `undefined` — ещё читается, `null` — нет в реплике |
| `useStatuses` | `(spaceId) => Ref<Row<'statuses'>[]>` | по `rank` |
| `useMembers` | `(spaceId) => Ref<Row<'users'>[]>` | пользователи из `spaceMembers`, без деактивированных, по `name` |
| `useLabels` | `(spaceId) => Ref<Row<'labels'>[]>` | по `name` |
| `useProjectTasks` | `(projectId) => Ref<TaskView[]>` | все задачи проекта (с подзадачами); проекция в памяти: IndexedDB читается один раз на проект, дальше патчится по `onReplicaChange` (без перечитывания); в памяти — до 3 последних проектов (LRU); при `replicaState = 'partial'` для непрочитанного проекта — дочитывает по завершении |
| `prefetchProject` | `(projectId: string) => void` | заранее строит проекцию проекта (наведение на ссылку проекта, простой после первого проекта); повторный вызов — ничего |
| `useTask` | `(idOrKey) => Ref<TaskView \| null \| undefined>` | uuid или ключ `PLN-123`; `undefined` — ещё читается, `null` — нет в реплике |
| `groupTasks` | `(tasks, by: GroupBy, ctx: {statuses, members, labels}) => TaskGroup[]` | чистая; статусы — в порядке `rank`, приоритет 1→4, затем 0; «без исполнителя»/«без метки» — последней группой; задача с несколькими исполнителями/метками — в каждой своей группе |
| `sortTasks` | `(tasks, by: SortBy, dir: 'asc' \| 'desc') => TaskView[]` | чистая, стабильная; `null` — в конце при любом `dir` |
| `createTask` | `(a: {projectId, statusId, title, after?: string \| null, before?: string \| null, parentId?, priority?, dueDate?, assigneeIds?, labelIds?}) => Promise<string>` | `after`/`before` — `rank` соседей; без них — в конец; id и `rank` считает сам; возвращает id |
| `updateTask` | `(id, patch: {title?, description?, statusId?, priority?, dueDate?, startDate?, projectId?, parentId?, fields?}) => Promise<void>` | `task.update` |
| `moveTask` | `(id, to: {statusId?: string; after: string \| null; before: string \| null}) => Promise<void>` | новый `rank` между соседями (+ статус) одной мутацией |
| `setAssignees` | `(taskId, userIds: string[]) => Promise<void>` | разница → `task.assign`/`task.unassign` |
| `setLabels` | `(taskId, labelIds: string[]) => Promise<void>` | разница → `task.addLabel`/`task.removeLabel` |
| `deleteTask` | `(id) => Promise<void>` | `task.delete` |
| `StatusPicker`, `AssigneePicker`, `PriorityPicker`, `DueDatePicker`, `LabelPicker` | SFC: `v-model` (статус — id; исполнители, метки — `string[]`; приоритет — `0..4`; срок — `'YYYY-MM-DD' \| null`), `spaceId` (кроме приоритета и срока), `compact?: boolean` (только иконка — для строк и карточек) | на `ui/Popover` + поиск по вводу, клавиатура; `update:modelValue` — вызывающий сам вызывает `updateTask`/`setAssignees`/`setLabels` |
| `StatusIcon`, `PriorityIcon` | SFC: `status: Row<'statuses'>` / `priority: number` | иконка по категории статуса и его `color`; приоритет — токены `--color-priority-*` |

## C-views v2

Экран проекта и стык видов — `apps/web/src/views/` (каркас — WB-4a; виды — WB-4 «Список», WB-5 «Доска»; панель задачи — WB-6; потребители — WB-7, WB-8, модули). Контрактный тест — `apps/web/src/__contract__/views.contract.test.ts`.

### Экран проекта `/p/:projectId/:view?`
- `ProjectScreen.vue`: шапка (название и ключ проекта), вкладки видов, панель «Группировка / Сортировка / Подзадачи», область вида; `?task=<key>` — справа панель задачи (desktop).
- Встроенный вид — компонент `apps/web/src/views/<id>/View.vue`, находится через `import.meta.glob('../views/*/View.vue')` (ленивые чанки); `id` = `list` (по умолчанию), `board`. Нет файла — вид не показывается во вкладках. Виды модулей — `useExtensions('views')`, `view` = `<moduleId>:<id>`.
- Панель задачи — `apps/web/src/task/TaskPanel.vue` (WB-6), через `import.meta.glob('../task/TaskPanel.vue')`; нет файла — панель не открывается. Пропсы `{ taskKey: string; mode: 'panel' \| 'page' }`, событие `close`. `/t/:key` (`TaskScreen.vue`) показывает её с `mode: 'page'`.

### Экспорты `apps/web/src/views/index.ts`
| Имя | Сигнатура | Поведение |
|---|---|---|
| `ViewProps` | тип `{ projectId: string; options: ViewOptions; filter?: Filter \| null }` | пропсы каждого `View.vue` и вида модуля; вид показывает только задачи, где `matchFilter` = true |
| `ViewOptions` | тип `{ groupBy: GroupBy; sortBy: SortBy; sortDir: 'asc' \| 'desc'; showSubtasks: boolean; fields: TaskField[] }` | `GroupBy`, `SortBy` — C-tasks; `fields` — видимые поля строки списка (доска — карточки) |
| `TaskField` | тип `'status' \| 'assignee' \| 'priority' \| 'dueDate' \| 'labels' \| 'project'` | |
| `Filter` | тип `{ op: 'and' \| 'or'; rules: FilterRule[] }` | один уровень; пустой `rules` — все задачи; хранится в `savedViews.filter` как есть |
| `FilterRule` | тип `{ field: 'status' \| 'statusCategory' \| 'assignee' \| 'priority' \| 'label' \| 'dueDate' \| 'title' \| 'createdBy'; operator: 'in' \| 'notIn' \| 'isEmpty' \| 'isNotEmpty' \| 'before' \| 'after' \| 'contains'; value?: string[] \| number[] \| string }` | `in`/`notIn` — массив id (приоритет — числа, `statusCategory` — категории); `before`/`after` — `YYYY-MM-DD` или `today`, `today+N`, `today-N`; `contains` — подстрока без регистра; значение `'me'` в `assignee`/`createdBy` — текущий пользователь |
| `useViewOptions` | `(projectId: MaybeRefOrGetter<string>, view: MaybeRefOrGetter<string>) => Ref<ViewOptions>` | по умолчанию `{groupBy: 'status', sortBy: 'rank', sortDir: 'asc', showSubtasks: false, fields: ['status', 'assignee', 'priority', 'dueDate', 'labels']}`; хранится в `localStorage['planar.view.<projectId>.<view>']` (try/catch) |
| `useSelection` | `() => { selected: Readonly<Ref<ReadonlySet<string>>>; set(ids: string[]): void; toggle(id: string): void; range(ids: string[], toId: string): void; clear(): void; anchor: Readonly<Ref<string \| null>> }` | одно состояние на приложение; `range` — от `anchor` до `toId` по порядку `ids` (Shift); смена проекта — `clear()` |
| `openTask` | `(key: string) => void` | desktop — `?task=<key>` на текущем маршруте проекта, mobile или вне проекта — `/t/<key>` |
| `closeTask` | `() => void` | убирает `?task` |
| `matchFilter` | `(task: TaskView, filter: Filter \| null \| undefined, ctx: { statuses: Row<'statuses'>[]; userId: string; today: string }) => boolean` | чистая; `null`/пустые `rules` → true; `and` — все правила, `or` — хотя бы одно; `isEmpty` у `assignee`/`label` — нет связей, у `dueDate` — `null` |

### Сохранённый вид (`savedViews`)
`layout` — id вида (`list`, `board`, `<moduleId>:<id>`), `filter` — `Filter`, `config` — `ViewOptions`; неизвестные поля `config` игнорируются, отсутствующие — по умолчанию. Личный — `view.create` с `personal: true`; общий — `personal: false` (видят все участники пространства). Экран `/p/:projectId/v/:viewId` показывает вид `layout` с `options = config` и `filter`; правка опций на нём меняет черновик, «Сохранить» — `view.update`.
