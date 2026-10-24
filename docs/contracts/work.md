---
type: reference
status: active
module: work
updated: 2026-10-23
summary: Контракты work — C-modules v3, C-schema v7, F-filter v2, модули time, sprints, automations, webhooks, import, REST/MCP
related: ["docs/contracts/core.md", "docs/contracts/core-mutators.md", "docs/contracts/core-api-v1.md", "docs/contracts/web.md", "docs/contracts/features.md", "docs/plan/work.md"]
---

# Контракты модуля work

Владелец — координатор work. Потребители: исполнители WK-*, модуль collab (C-modules v3). Контрактный тест — `apps/api/test/work-contract.test.ts`: сущности (`#### …` в формате C-schema) и имена мутаторов каждого установленного модуля сверяются с этим файлом; модуль, которого ещё нет в `installed.ts`, — `it.todo`. Блоки ` ```json example=… ` проверяет тот же тест.

Модули: `time` (WK-1), `sprints` (WK-2), `automations` (WK-3), `webhooks` (WK-4), `import` (WK-6) — каталоги `modules/<id>/` по C-modules, пакет `@planar/module-<id>`, строка в `apps/api/src/modules/installed.ts`. Имена мутаторов — `<id>.<действие>`, сущностей — `<id>` + имя в camelCase, серверных таблиц — `<id>_…`.

Системный пользователь (WK-0): строка `users` `login = 'automation'`, `name = 'Автоматизация'`, `role = 'member'`, `deactivatedAt` задан (не входит, не виден в выборе людей), без пароля. Создаётся идемпотентно при старте API. От его имени работают автоматизации и cron модулей.

## C-modules v3 (WK-0)

v3: серверный хук `afterMutation`, фоновые задачи модулей (pg-boss), выполнение мутаций от системы, web-точки `nav` и `topbar`. Остальное — как v2 (`docs/contracts/core.md` §C-modules).

### Сервер
Типы без Node API — `packages/shared/src/contract/modules.ts`:
```ts
export interface MutationWrite {
  entity: string; op: 'put' | 'del';
  before: Record<string, unknown> | null;  // строка до (провод), null — не было
  after: Record<string, unknown> | null;   // строка после, null — удалена
}
export interface MutationOrigin { ruleId: string; depth: number } // мутация сделана правилом автоматизации
export interface AfterMutationCtx {
  userId: string; now: string; tokenId: string | null;
  mutator: string;                // имя мутатора
  system: boolean;                // выполнено от системы (обход прав)
  origin: MutationOrigin | null;
}
export interface BackendModuleManifest {
  /* … v2 … */
  afterMutation?: (writes: MutationWrite[], ctx: AfterMutationCtx, api: never /* ModuleHookApi; never — чтобы модуль с типизированным api присваивался при strictFunctionTypes */) => Promise<void>;
  jobs?: unknown[];               // JobDef[]
}
```
Типы с Node API — `apps/api/src/modules/hooks.ts` (экспорт для модулей: `@planar/api/modules`, `exports["./modules"]` в `apps/api/package.json`):
```ts
export interface JobOpts { startAfter?: number /* сек */ | Date; singletonKey?: string }
export interface ModuleHookApi {
  q: Q;                 // транзакция мутации (внутри точки сохранения хука)
  sys: ServerTx;        // запись от системы: обход прав, попадает в changes
  enqueue(queue: string, data: object, opts?: JobOpts): Promise<void>; // pg-boss send в этой же транзакции (опция db)
}
export interface JobApi {
  db: Db;
  /** мутации одной транзакцией, как executeMutations; system — обход прав от имени userId */
  execute(userId: string, muts: { name: string; args: unknown }[],
          opts?: { system?: boolean; origin?: MutationOrigin | null }): Promise<void>;
  enqueue(queue: string, data: object, opts?: JobOpts): Promise<void>; // вне транзакции
  systemUserId: string; // id пользователя «Автоматизация»
}
export interface JobDef<D = Record<string, unknown>> {
  queue: string;        // `<moduleId>.<имя>`
  handler(data: D, api: JobApi): Promise<void>; // throw → повтор по retry*
  cron?: string;        // pg-boss schedule, UTC; data = {}
  retryLimit?: number; retryDelay?: number; retryBackoff?: boolean; expireInSeconds?: number;
  localConcurrency?: number; // по умолчанию 1
}
```
Правила:
- `runMutation` (`apps/api/src/sync/mutate.ts`): `run` → хук уведомлений → `afterMutation` каждого **включённого** модуля в порядке `installed` → `finish()`. `writes` — записи самой мутации (`ServerTx.writes`), без записей хуков; записи хуков хуки не вызывают.
- Хук модуля — внутри точки сохранения (`tx.transaction` Drizzle). Ошибка хука → откат точки сохранения, `log.error`, мутация продолжается и коммитится.
- `enqueue` из хука — в той же транзакции: откат мутации — задачи нет; задача видит закоммиченные данные.
- Одна `PgBoss` на процесс (общая с push, `apps/api/src/jobs/jobs.ts`): при старте создаются очереди всех `jobs` установленных модулей, воркеры и расписания (`cron`). Выключенный модуль: воркер берёт задачу и завершает её без вызова `handler`.
- `push.boss: false` (тесты по умолчанию) — `enqueue` ничего не делает, воркеров нет. Тесты задач модулей поднимают приложение с `push: {boss: true}`.
- `executeMutations(db, userId, muts, queue?, tokenId?, opts?: {system?, origin?})` — `system: true` → `ServerTx.asSystem` с `ctx.userId = userId`; `activity.actorId`, уведомления, `changes` — как обычно.
- Модуль, которому нужен `Db`, получает его из Nest-провайдера `DB` (`apps/api/src/tokens.ts`, глобальный).

### Web
`EXTENSION_KINDS` += `'nav'`, `'topbar'` (`FrontendModuleManifest` в shared — те же поля `nav?`, `topbar?`):
```ts
type NavItemDef = { id: string; order?: number } & (
  | { label: LocalizedText; icon: Component; to: string /* /m/<moduleId>/… */ }   // ссылка
  | { section: Lazy<{}> }                                                         // секция: свой компонент (список каналов, дерево документов)
);
interface TopbarItemDef { id: string; component: Lazy<{}>; order?: number }
```
- `nav` — элементы в `Sidebar.vue` после встроенных («Inbox», «Мои задачи»), по `order`, затем по ключу: ссылка — пункт меню, `section` — компонент целиком (лениво, `defineAsyncComponent`; сам рисует заголовок и содержимое; ошибка загрузки секции не ломает боковую панель). На mobile элементы `nav` не показываются. `to` вне `/m/<moduleId>/`, или ни `to`, ни `section` → `registerModules` бросает `Error`.
- `topbar` — компоненты в `TopBar.vue` слева от меню пользователя, по `order`; desktop и mobile.

## C-modules v4 (WK-10)
v4: модулям — пакет `@planar/server-kit` (сервер) и SDK `@planar/web/modules` (web) вместо импорта ядра относительными путями; клиент синхронизации знает сущности и мутаторы модулей. v3 — без изменений.

### Сервер: `packages/server-kit` → `@planar/server-kit`
Зависимости — только `@planar/shared`, `drizzle-orm`, `@nestjs/common`, `zod` (без `@planar/api`: модули и api зависят от kit, цикла нет). Модули — `"@planar/server-kit": "workspace:*"`; импорт `@planar/api` из модулей запрещён.
```ts
export type Db = NodePgDatabase<Record<string, unknown>>;            // drizzle-orm/node-postgres
export type Q = PgDatabase<NodePgQueryResultHKT, Record<string, unknown>>;
export type { ModuleHookApi, JobApi, JobDef, JobOpts } from './hooks';  // перенос из apps/api/src/modules/hooks.ts; ModuleHookApi.sys: Tx (@planar/shared)
// JobApi.execute opts += prepare?: (q: Q) => Promise<boolean | void> — в той же транзакции до мутаций (блокировки, проверки); false → мутации не выполняются
// JobApi.execute opts += after?: (q: Q, enqueue: ModuleHookApi['enqueue']) => Promise<void> — в той же транзакции после всех мутаций; enqueue — в ней же; ошибка откатывает транзакцию и пробрасывается из execute (аддитивно, C-modules v8, PL-2)
export class HttpError extends HttpException { constructor(status: number, code: string, message: string) } // формат C-http «Ошибки»; ErrorFilter api его понимает
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T>; // 400 invalid_request
export interface AuthCtx { userId: string; role: 'owner' | 'admin' | 'member' | 'guest'; tokenId: string | null; tokenScope: 'read' | 'write' | null }
export interface CoreServices {
  db: Db;
  auth(req: object): AuthCtx;                       // как getAuth api; нет входа → 401
  requireInstanceAdmin(req: object, opts?: { sessionOnly?: boolean }): AuthCtx; // не owner/admin → 403; sessionOnly и Bearer → 403
  toV1Tasks(q: Q | Db, rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]>; // строки tasks → форма REST v1 (key, assigneeIds, labelIds)
  systemUserId(): string;
}
export const CORE = Symbol.for('planar.core');      // Nest-провайдер (глобальный) со значением CoreServices; модуль: @Inject(CORE) core: CoreServices
```
`apps/api` реализует `CoreServices` и реэкспортирует типы kit там, где они были (`@planar/api/modules` остаётся реэкспортом для обратной совместимости ядра; модулям — только kit).

### Web: SDK `@planar/web/modules`
`exports["./modules"]` → `apps/web/src/modules/sdk.ts`: всё прежнее из `types.ts` (`defineWebModule`, типы элементов) и для модулей —
`db` (PlanarDB), `useQuery`, `mutate(name, args)` (вызов мутатора по имени через клиент синхронизации), `useSession()` (текущий пользователь), `useTask`/`useProjectTasks`/словари (C-tasks), `openTask`, базовые компоненты `apps/web/src/ui` (C-ui), `useI18n`, `useWeekStart`, `localToday`, `matchFilter`. Модули импортируют web только отсюда. Typecheck web (`vue-tsc`) включает `modules/*/web/**`; Tailwind сканирует `modules/*/web/**`.

### Клиент синхронизации
- `apps/web/src/sync`: Dexie-схема = ядро + `entities` всех установленных модулей (`import.meta.glob('…/modules/*/shared/index.ts', {eager: true})` — shared-манифесты без Node API, малые). Новая или изменённая сущность модуля → версия схемы Dexie растёт детерминированно; база пользователя обновляется без ручной очистки (при несовместимости — пересоздание и bootstrap).
- `apps/web/src/session.ts` регистрирует мутаторы ядра и всех модулей (выключенный модуль сервер отвергает `unknown_mutator`).
- Бюджет начального JS (≤ 200 КБ gzip) сохраняется: в начальный чанк входят только shared-манифесты модулей, web-части — лениво.

### Неделя (WK-0, потребители WK-1, WK-7)
`apps/web/src/i18n/week.ts`: `useWeekStart(): Readonly<Ref<0 | 1>>` (0 — воскресенье, 1 — понедельник) и `setWeekStart(v: 'auto' | 0 | 1)`. Значение — `localStorage['planar.weekStart']` (`'auto'|'0'|'1'`, try/catch), `auto` и пусто — по локали i18n: `en` → 0, `ru` → 1.

## C-schema v7 (WK-0)
Изменение `tasks` (docs/contracts/core.md §C-schema): поле `cycleId` uuid? — цикл модуля `sprints`, без FK; индекс `cycleId` (БД и Dexie, `indexes: spaceId, projectId, parentId, statusId, cycleId`). Ядро: `task.create` — `cycleId = null`; смена `projectId` в `task.update` → `cycleId = null`; `task.update` `cycleId` не принимает (ставит только `sprints.setTask`). REST v1 `task` — с `cycleId` (строка `tasks`).

## F-filter v2 (WK-0)
- `matchFilter`, `Filter`, `FilterRule`, `FilterCtx`, `FIELD_OPERATORS`, `resolveDate` — в `packages/shared/src/filter.ts` (экспорт `@planar/shared`), без Vue и DOM; `apps/web/src/views/filter.ts` реэкспортирует (сигнатуры C-views/F-filter v1 не меняются). Тип задачи — `FilterTask = Row<'tasks'> & { assigneeIds: string[]; labelIds: string[] }` (`TaskView` web ему совместим).
- `FilterRule.field` += `'cycle'`: операторы `in`, `notIn` (id циклов или `'current'`), `isEmpty`, `isNotEmpty` (`cycleId` null).
- `FilterCtx` += `cycles?: { id: string; projectId: string; startDate: string; endDate: string; closedAt: string | null }[]`. Текущий цикл проекта — `closedAt = null` и `startDate ≤ today ≤ endDate`; `'current'` совпадает, если `cycleId` задачи — текущий цикл её проекта. Без `cycles` правила с `'current'` пропускаются.
- Web (WK-0): виды и сохранённые виды передают `cycles` из таблицы Dexie `sprintsCycles`, если она есть (модуль включён).

## F-views v2 (WK-7)
Изменения F-views v1 (docs/contracts/features.md) и C-views:
- `ViewOptions` += `columns?: { id: string; width: number }[]` — раскладка Таблицы (порядок = порядок массива, ширина 60–800 px, нет id в массиве — колонка скрыта; неизвестные id пропускаются). Хранится в `savedViews.config.columns` вместе с остальными опциями.
- Таблица берёт раскладку: `options.columns`, если задано; иначе `localStorage['planar.table.<projectId>']` (запасной вариант, формат v1); иначе по умолчанию. Правка ширины, порядка, видимости: на сохранённом виде — меняет черновик опций (`columns`), «Сохранить» — `view.update`; на вкладке проекта без сохранённого вида — localStorage, как в v1. «Сохранить как вид» с Таблицы кладёт текущую раскладку в `config.columns`.
- Календарь: первый день недели — `useWeekStart()` (§Неделя), а не всегда понедельник; профиль (`/profile`) — выбор «Авто / Понедельник / Воскресенье» (`setWeekStart`).

## Модуль time (WK-1)

#### timeEntries
scope: space · write: member · bootstrap: yes · indexes: spaceId, taskId, userId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | из задачи |
| `taskId` | uuid | без FK; удаление задачи — хук модуля удаляет записи (`sys.del`) |
| `userId` | uuid | = ctx.userId; правит и удаляет только владелец |
| `startedAt` | ts | |
| `endedAt` | ts? | null — таймер идёт |
| `durationSec` | int? | null, пока идёт; иначе секунды ≥ 0 |
| `note` | text? | ≤ 1000 |
| `source` | enum(timer,manual) | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

БД: частичный уникальный индекс `(user_id) where ended_at is null` — один идущий таймер на пользователя (нарушение → `conflict`).

#### timeEstimates
scope: space · write: member · bootstrap: yes · indexes: taskId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | = `taskId` |
| `spaceId` | uuid | |
| `taskId` | uuid | без FK; удаляется с задачей хуком модуля |
| `minutes` | int | 1–100000 |
| `updatedBy` | uuid | |
| `updatedAt` | ts | |

| мутатор | args | правила |
|---|---|---|
| `time.start` | `id, taskId` | идущие записи ctx.userId останавливаются (`endedAt = ctx.now`, `durationSec`); новая: `startedAt = ctx.now`, `source = timer` |
| `time.stop` | `id` | только своя; уже остановлена — ничего; `endedAt = ctx.now`, `durationSec = floor((endedAt − startedAt)/1000)` |
| `time.log` | `id, taskId, startedAt, durationSec, note?` | `durationSec` 1–86400; `endedAt = startedAt + durationSec`; `source = manual` |
| `time.update` | `id, startedAt?, endedAt?, durationSec?, note?` | только своя; `durationSec` задан → `endedAt = startedAt + durationSec`, иначе пересчёт из `startedAt`/`endedAt`; `endedAt < startedAt` → `invalid_args`; у идущей — только `startedAt`, `note` |
| `time.delete` | `id` | только своя |
| `time.setEstimate` | `taskId, minutes: int\|null` | `null` — удалить; `updatedBy = ctx.userId` |

- Длительность считает сервер: серверный прогон мутатора пересчитывает `startedAt`/`endedAt`/`durationSec` от серверного `ctx.now`, клиентская оценка перезаписывается синхронизацией.
- Два устройства: гонка двух `time.start` — второй получает `conflict` по индексу; клиент показывает таймер, пришедший с сервера.
- Сумма на задаче = свои записи + записи всех подзадач (рекурсивно); идущий таймер — `now − startedAt` на клиенте.
- Web: `taskPanels` `time:timer` (кнопка, сумма, оценка против факта, список записей), `topbar` `time:timer` (идущий таймер тикает локально, стоп), `nav` `time:week` → `/m/time/week` («Мои часы»: таблица день × задача текущего пользователя, неделя с `useWeekStart()`, правка ячейки — новая сумма дня: разница добавляется `time.log` или снимается правкой/удалением ручных записей дня; 0 — удалить записи дня).

## Модуль sprints (WK-2)

#### sprintsSettings
scope: space · write: member · bootstrap: yes · indexes: projectId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | = `projectId` |
| `spaceId` | uuid | |
| `projectId` | uuid | |
| `enabled` | bool | |
| `lengthDays` | int | 1–60, по умолчанию 14 |
| `timezone` | text | IANA (`Europe/Moscow`); по умолчанию — часовой пояс браузера при включении |
| `autoCreate` | bool | создавать следующий цикл при закрытии; по умолчанию true |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### sprintsCycles
scope: space · write: member · bootstrap: yes · indexes: spaceId, projectId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `projectId` | uuid | |
| `number` | int | 1, 2, …; уникально (projectId, number); мутатор ставит max + 1 |
| `name` | text? | ≤ 100 |
| `startDate` | date | |
| `endDate` | date | включительно, ≥ `startDate` |
| `closedAt` | ts? | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

Циклы проекта не пересекаются по датам (нарушение → `conflict`).

| мутатор | args | правила |
|---|---|---|
| `sprints.configure` | `projectId, enabled?, lengthDays?, timezone?, autoCreate?` | put `sprintsSettings` (id = projectId); неверный `timezone` (`Intl.DateTimeFormat` бросает) → `invalid_args` |
| `sprints.create` | `id, projectId, startDate, endDate?, name?` | `endDate` по умолчанию `startDate + lengthDays − 1` |
| `sprints.update` | `id, name?, startDate?, endDate?` | закрытый → `conflict` |
| `sprints.delete` | `id` | задачам с `cycleId = id` — `cycleId = null` |
| `sprints.setTask` | `taskId, cycleId: uuid\|null` | цикл — проекта задачи и не закрыт, иначе `invalid_args` |
| `sprints.close` | `id, nextId` | уже закрыт — ничего; `closedAt = ctx.now`; задачи с `cycleId = id` не в категории done/cancelled → в следующий цикл: ближайший незакрытый с `startDate > endDate`, иначе при `autoCreate` — новый `nextId` с `startDate = endDate + 1`, длина `lengthDays`; иначе `cycleId = null` |

- Cron `sprints.close-due` (каждые 10 мин): незакрытые циклы с `endDate < сегодня` в `timezone` проекта → `sprints.close` от системного пользователя, по одной задаче pg-boss на цикл (`singletonKey = cycleId`); строка цикла блокируется (`select … for update`) до мутатора. Перенос — ровно один раз (повтор задачи, два воркера, ручное закрытие одновременно).
- Web: вид `sprints:sprint` (вкладка проекта): текущий цикл, прогресс по категориям статусов, burn-up (ось — дни цикла; объём — число задач цикла сейчас; сделано — задачи цикла с `completedAt` ≤ дня), кнопка «Закрыть»; настройки спринтов проекта — в том же виде; поле «Спринт» в панели задачи (`taskPanels` `sprints:cycle`); в конструкторе фильтра — правило «Спринт» (`cycle`, вариант «Текущий»).

## Модуль automations (WK-3)

#### automationsRules
scope: space · write: member · bootstrap: yes · indexes: spaceId, projectId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `projectId` | uuid | правило срабатывает на задачах этого проекта |
| `name` | text | 1–100 |
| `enabled` | bool | |
| `trigger` | obj | `{type, …параметры}` — каталог ниже |
| `conditions` | obj | `Filter` (F-filter v2), `{op:'and', rules:[]}` — всегда |
| `actions` | json | массив 1–10 действий, каталог ниже |
| `createdBy` | uuid | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

| мутатор | args | правила |
|---|---|---|
| `automations.create` | `id, projectId, name, trigger, conditions?, actions, enabled?` | схемы `triggerSchema`, `actionSchema`, `filterSchema` (экспорт `modules/automations/shared`); неверно → `invalid_args`; `enabled` по умолчанию true |
| `automations.update` | `id, name?, trigger?, conditions?, actions?, enabled?` | |
| `automations.delete` | `id` | |

### Триггеры
| `type` | параметры | срабатывает |
|---|---|---|
| `task.created` | — | `tasks` put, `before = null` |
| `task.status_changed` | `from?: uuid[]`, `to?: uuid[]` | изменился `statusId`; заданы `from`/`to` — старый/новый в списке |
| `task.assignee_changed` | `userId?: uuid` | `taskAssignees` put (новый) или del; `userId` — только добавление этого пользователя |
| `task.field_changed` | `field: 'title'\|'description'\|'priority'\|'dueDate'\|'startDate'\|'parentId'\|'field:<uuid>'` | значение поля изменилось (`fields[id]` для `field:`) |
| `task.due` | `daysBefore: int 0–30` | cron `automations.due` (каждый час): задача не done/cancelled, `dueDate − daysBefore ≤ сегодня` в `settings.timezone` (ключ инстанса, IANA, по умолчанию `UTC`); один раз на (правило, задача, `dueDate`) |
| `comment.added` | — | `comments` put, `before = null` |

Проект правила — `projectId` задачи после мутации. Удалённые задачи не запускают правил.

### Условия и действия
Условия — `matchFilter(task, conditions, {statuses, fieldDefs, userId: системный, today})` на текущей строке задачи в момент выполнения; не выполнено → запуск `skipped`.

| `type` | параметры | мутатор |
|---|---|---|
| `set_status` | `statusId` | `task.update` |
| `assign` | `userId` | `task.assign` |
| `unassign` | `userId` | `task.unassign` |
| `add_label` | `labelId` | `task.addLabel` |
| `remove_label` | `labelId` | `task.removeLabel` |
| `set_field` | `field: 'priority'\|'dueDate'\|'startDate'\|'field:<uuid>'`, `value` | `task.update` / `task.setField`; даты — `YYYY-MM-DD`, `today±N` или `null` |
| `add_comment` | `text` 1–5000 | `comment.create` (`textToDoc`) |
| `move_to_project` | `projectId`, `statusId?` | `task.update` |
| `create_subtask` | `title` 1–500 | `task.create` с `parentId`; статус — первый по `rank` категории todo, иначе backlog |
| `send_webhook` | `subscriptionId` | `enqueueWebhookEvent` модуля webhooks, событие `automation.fired` |

### Выполнение
- Хук `afterMutation`: по `writes` — подходящие включённые правила → `enqueue('automations.run', {ruleId, taskId, depth, eventAt})`, `depth = (ctx.origin?.depth ?? 0) + 1`. Не ставится, если `depth > 3` или `ruleId = ctx.origin.ruleId` (правило не срабатывает на своё действие).
- Воркер `automations.run`: правило выключено/удалено, задачи нет — `skipped`; иначе все действия одной транзакцией `JobApi.execute(systemUserId, muts, {system: true, origin: {ruleId, depth}})`. Ошибка → откат действий, запуск `error` с текстом; исходная мутация не затрагивается. Без повторов (`retryLimit: 0`).
- Серверные таблицы: `automations_runs` (`id uuid pk`, `rule_id uuid`, `task_id uuid`, `depth int`, `status text check (ok,skipped,error)`, `error text?`, `created_at`; индекс `(rule_id, created_at desc)`; cron удаляет старше 30 дней), `automations_due_fired` (`rule_id`, `task_id`, `due_date date`; pk из трёх).
- REST: `GET /api/automations/rules/:id/runs?limit=` (1–200, по умолчанию 50) → `{data: run[]}` новые сверху; правило невидимо → 404. `run` = `{id, ruleId, taskId, depth, status, error, createdAt}`.
- Web: страница настроек `automations:rules` (выбор проекта, список правил, конструктор «триггер → условия (конструктор фильтра) → действия», журнал запусков).

## Модуль webhooks (WK-4)
Синхронизируемых сущностей нет (секрет не должен попасть в клиент). Серверные таблицы:
- `webhooks_subscriptions`: `id uuid pk`, `url text`, `events text[]`, `secret text`, `active bool`, `description text?`, `created_by uuid`, `created_at`, `updated_at`.
- `webhooks_deliveries`: `id uuid pk` (= `X-Planar-Delivery`), `subscription_id uuid` (`on delete cascade`), `event text`, `payload jsonb`, `status text check (pending,ok,failed)`, `attempts int`, `next_attempt_at timestamptz?`, `last_status int?`, `last_error text?`, `created_at`, `updated_at`; индекс `(subscription_id, created_at desc)`.

REST — только `users.role` ∈ {owner, admin}, иначе 403; Bearer → 403 (как `/api/tokens`). `subscription` — без `secret`.

| метод и путь | вход → выход |
|---|---|
| `GET /api/webhooks/subscriptions` | → `{data: subscription[]}` |
| `POST /api/webhooks/subscriptions` | `{url, events: string[] (≥1), description?}` → `201 {data, secret}` |
| `PATCH /api/webhooks/subscriptions/:id` | `{url?, events?, active?, description?}` → `{data}` |
| `POST /api/webhooks/subscriptions/:id/rotate-secret` | → `{secret}` |
| `DELETE /api/webhooks/subscriptions/:id` | → `204` |
| `POST /api/webhooks/subscriptions/:id/ping` | → `202 {data: delivery}` (событие `ping`) |
| `GET /api/webhooks/subscriptions/:id/deliveries?limit=&cursor=` | → `{data: delivery[], nextCursor}` новые сверху |
| `POST /api/webhooks/deliveries/:id/redeliver` | → `202 {data: delivery}` — новая доставка с тем же `payload` (новый `id`) |

`url` — `http:`/`https:`, без userinfo, ≤ 2000; иначе 400. `secret` — `whsec_` + 32 случайных байта в base62.

### События
`task.created`, `task.updated`, `task.deleted`, `comment.created` — из хука `afterMutation` (одно событие на задачу на мутацию; `task.updated` — изменения строки `tasks`, исполнителей, меток); `ping`; `automation.fired` — только действием `send_webhook` в указанную подписку (в `events` подписки быть не обязано; подписка должна быть `active`).

Тело — `{id, event, createdAt, data}`, UTF-8, `JSON.stringify`; подписываются ровно отправленные байты.
- `task.created`, `task.updated`: `data = {task, changes, actorId}` — `task` в форме REST v1, `changes` — `{<поле>: [старое, новое]}` (как `activity.changes`; `assigneeIds`, `labelIds` — массивы), у `created` — `{}`;
- `task.deleted`: `data = {task: {id, key, projectId, spaceId}, actorId}`;
- `comment.created`: `data = {task, comment: {id, taskId, authorId, text, createdAt}, actorId}` (`text` — текст `body`);
- `automation.fired`: `data = {ruleId, task}`; `ping`: `data = {}`.

Экспорт для automations — `@planar/module-webhooks/api`: `enqueueWebhookEvent(api: ModuleHookApi | JobApi, subscriptionId: string, event: string, data: object): Promise<void>`.

### Доставка
- Заголовки: `Content-Type: application/json`, `User-Agent: Planar-Webhooks/1`, `X-Planar-Event`, `X-Planar-Delivery`, `X-Planar-Signature: sha256=<hex HMAC-SHA256(secret, тело)>` (ключ — строка `secret` целиком, UTF-8).
- Задача pg-boss `webhooks.deliver {deliveryId}`. Успех — ответ 2xx за ≤ 10 с (соединение + ответ); иначе попытка неудачна. 3xx — неудача, редиректы не выполняются. Тело ответа не читается: после статуса соединение закрывается.
- Повторы: после неудачной попытки n (1–10) следующая через `60·2^(n−1)` с (1, 2, 4 … 512 мин; 11 попыток за ≈ 17,1 ч ≤ 24 ч); после 11-й — `failed`. `next_attempt_at` — время следующей попытки; повтор — новая задача с `startAfter`.
- **SSRF:** перед каждой попыткой — DNS-резолв, все адреса проверяются; запрещены `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.168/16`, `224/4` и выше, `::`, `::1`, `fc00::/7`, `fe80::/10`, `ff00::/8`, IPv4-mapped (`::ffff:`) от запрещённых. Соединение — на проверенный адрес (`node:http`/`node:https` `request` со своим `lookup`, отдающим проверенный адрес; без повторного резолва; SNI и `Host` — исходное имя). Запрещённый адрес → `failed` сразу, `last_error = 'blocked_address'`, без повторов. Исключения — env `WEBHOOKS_ALLOW_HOSTS` (через запятую: имена хостов или CIDR), только для dev и e2e.
- Web: страница настроек `webhooks:settings` (только админ): подписки, секрет показывается один раз, журнал доставок, «Повторить», «Проверить» (ping).

Эталон проверки подписи (получатель, Node):
```js
import { createHmac, timingSafeEqual } from 'node:crypto';
const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
const ok = header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
```

```json example=webhook.signature
{"secret": "whsec_test", "body": "{\"id\":\"0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6c01\",\"event\":\"ping\",\"createdAt\":\"2026-10-23T06:00:00.000Z\",\"data\":{}}", "signature": "sha256=a43c17381401da94222350b1503b6bcef9ff6ef41b99d0b29a8df25c68b0dac1"}
```

## Модуль import (WK-6)
Серверные таблицы:
- `import_jobs`: `id uuid pk`, `user_id uuid`, `project_id uuid`, `format text check (csv,trello)`, `preset text` (`clickup`, `jira`, `linear`, `custom`, `trello`), `status text check (pending,running,done,failed)`, `total int`, `processed int`, `created int`, `updated int`, `skipped jsonb` (`{row, reason}[]`), `warnings jsonb` (`{row, message}[]`), `error text?`, `created_at`, `updated_at`.
- `import_items`: `project_id uuid`, `preset text`, `external_id text`, `task_id uuid`, `updated_at`; pk `(project_id, preset, external_id)`.

| метод и путь | вход → выход |
|---|---|
| `POST /api/import/preview` | multipart: `file`, `format`, `preset` → `{columns: string[], rows: string[][] /* ≤ 20 */, mapping: Mapping /* предложение по preset */}` |
| `POST /api/import/jobs` | multipart: `file`, `projectId`, `format`, `preset`, `mapping` (JSON) → `202 {data: job}` |
| `GET /api/import/jobs/:id` | → `{data: job}`; чужая → 404 |

- `Mapping` = `{externalId?, title, description?, status?, assignee?, labels?, dueDate?, startDate?, priority?, parent?}` — имя колонки CSV; `statusMap?: {<значение>: statusId}` (неизвестное — статус по умолчанию, как REST v1); `labels` — через запятую, по имени, недостающие создаются `label.create`; `assignee` — по email, затем по login (без регистра), неизвестный — без исполнителя и строка в `warnings`; `parent` — внешний ID родителя в том же файле; Trello JSON — сопоставление фиксированное (карточки, списки → статусы, метки, участники, чек-листы → `checklist.add`).
- Идемпотентность: строка с `externalId`, уже бывшая в `import_items`, обновляет задачу (`task.update`, полная замена исполнителей и меток), а не создаёт новую. Без `externalId` — всегда новая.
- Задача pg-boss `import.run {jobId}`: от имени `user_id` (его права), пачками по 100 строк в транзакции; `processed` растёт после каждой пачки. Пропущенные строки (нет заголовка, ошибка мутатора) — в `skipped` с причиной, импорт продолжается.
- Пределы: файл ≤ 10 МБ, ≤ 20 000 строк; больше → 400.
- Эталоны — `e2e/fixtures/import/` (`clickup.csv`, `jira.csv`, `linear.csv`, `trello.json`, `README.md` с источником формата для каждого).
- Web: маршрут `/m/import/` (мастер: файл → формат и заготовка → сопоставление и предпросмотр → прогресс и отчёт), команда `import:open`.

## REST и MCP (WK-5), C-modules v5
Вынесены в docs/contracts/work-api.md (размер документа).
