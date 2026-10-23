---
type: contract
status: active
module: core
updated: 2026-10-22
summary: Контракты core — C-schema, C-sync, C-mutators, C-modules, C-http; версии в заголовках, примеры проверяет контрактный тест
related: ["docs/plan/core.md", "docs/roadmap.md"]
contracts: [{"id": "C-schema", "version": 4}, {"id": "C-sync", "version": 1}, {"id": "C-mutators", "version": 2}, {"id": "C-modules", "version": 1}, {"id": "C-http", "version": 4}]
---

# Контракты модуля core

Владелец всех контрактов файла — координатор core. Меняет только он: версия +1 в заголовке и в `CONTRACT_VERSIONS`, потребителям — `task note`. C-sync и C-mutators после выдачи WB-2 — только через шлюз.

**Контрактный тест** — `packages/shared/test/contract.test.ts` (правит только координатор). Он сверяет с этим файлом:
- версии из заголовков `## C-… vN` = `CONTRACT_VERSIONS`;
- каждый блок ` ```json example=<имя> ` проходит `contractSchemas[<имя>]`, каждый ` ```json bad=<имя> ` — нет; у каждой схемы есть пример;
- сущности раздела «Сущности»: имена, поля, nullability, строка `scope · write · bootstrap · indexes` = `entitySchemas` и `ENTITIES`.

Схема БД против этого файла — `apps/api/test/contract.schema.test.ts` (появится до CR-2).

Код контрактов — `packages/shared/src/contract/` (экспорт из `packages/shared/src/index.ts`, без Node API): `CONTRACT_VERSIONS`, `contractSchemas`, `entitySchemas`, `ENTITIES`, типы `Tx`, `MutatorCtx`, `MutatorDef`, функции `defineMutator`, `createRegistry`, класс `MutatorError`, `uuidv7()`.

## C-schema v4

### Общие правила
- БД — snake_case, TS и провод — camelCase (Drizzle `casing: 'snake_case'`). Имя поля на проводе = имя свойства Drizzle; колонка = snake_case от него (`spaceId` → `space_id`).
- Имя сущности (entity) = имя таблицы в camelCase: `taskAssignees` ↔ `task_assignees`. Оно же — ключ в `bootstrap.data`, `changes.entity`, аргумент `Tx`.
- `id` — `uuid` (uuidv7, создаёт клиент; серверные строки — `uuidv7()` Postgres 18), кроме `settings.id` (`text`, ключ настройки). PK — `id`.
- Строка на проводе содержит **все** поля сущности; отсутствующее значение — `null` (не пропуск ключа).
- `createdAt`/`updatedAt` ставит мутатор из `ctx.now`; на сервере `ctx.now` — серверное время.
- `spaceId` неизменяем после создания (patch с другим `spaceId` → `invalid_args`); у задач, комментариев, вложений, чек-листов, меток задач он денормализован.
- Enum — `text` + `CHECK`. `rank` — `text COLLATE "C"` (ключи fractional-indexing сравниваются побайтно).
- FK между синхронизируемыми таблицами — без каскада (`NO ACTION`): мутатор удаляет дочерние строки сам, через `Tx`, иначе клиент не узнает об удалении. Исключения — `activity.taskId`, `notifications.taskId/commentId` (без FK, история переживает задачу). Несинхронизируемые таблицы ссылаются на `users` с `ON DELETE CASCADE`.

### Типы
| тип | zod | Postgres |
|---|---|---|
| `uuid` | `z.uuid()` | `uuid` |
| `text` | `z.string()` | `text` |
| `int` | `z.number().int()` | `integer` (`size` — `bigint`, mode number) |
| `bool` | `z.boolean()` | `boolean` |
| `ts` | `z.iso.datetime()` (UTC, `Z`, мс) | `timestamptz` |
| `date` | `z.iso.date()` (`YYYY-MM-DD`) | `date` |
| `rank` | `z.string().min(1)` | `text COLLATE "C"` |
| `obj` | `z.record(z.string(), z.unknown())` | `jsonb` (объект) |
| `json` | `z.json()` | `jsonb` (любой JSON) |
| `doc` | TipTap JSON: `z.looseObject({type: z.literal('doc'), content: z.array(z.unknown()).optional()})` | `jsonb` |
| `enum(a,b)` | `z.enum([...])` | `text` + `CHECK` |
| `uuid[]` | `z.array(z.uuid())` | `uuid[]` |

Суффикс `?` — `.nullable()` (ключ есть, значение может быть `null`).

### Видимость и права (строка под заголовком сущности)
- `scope` — кто видит строку (bootstrap, pull): `space` — участники пространства `spaceId` (у `spaces` — `id`); `user` — только `userId`; `global` — все вошедшие; `space|user` — `user`, если `userId` не null, иначе `space`.
- `write` — минимальная роль для записи через серверный `Tx`: `guest` < `member` < `admin` — роль в `spaceMembers` этого пространства; `self` — `row.userId = ctx.userId`; `instance_admin` — `users.role` ∈ {owner, admin}; `server` — только серверный код, мутаторам запрещено; `member|self` — по `scope` строки.
- Создание пространства (`put` в `spaces` новой строки) разрешено любому с `users.role` ≠ guest; в той же транзакции он может создать себе `spaceMembers` с ролью admin.
- `bootstrap` — входит ли сущность в `GET /sync/bootstrap` (`no` — только через pull и свой REST).
- `indexes` — поля, по которым разрешён `Tx.scan({index, eq})` (в Dexie это индексы; в БД — b-tree).

### Сущности

#### users
scope: global · write: server · bootstrap: yes · indexes: login

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `login` | text | уникален, в нижнем регистре |
| `name` | text | |
| `email` | text? | |
| `role` | enum(owner,admin,member,guest) | роль в инстансе; owner — первый пользователь |
| `avatarFile` | text? | sha256 файла |
| `deactivatedAt` | ts? | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

Только в БД: `password_hash text` (argon2id). В провод не попадает никогда.

#### spaces
scope: space · write: admin · bootstrap: yes · indexes: —

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | он же spaceId для видимости |
| `name` | text | 1–100 |
| `description` | text? | |
| `color` | text? | |
| `icon` | text? | |
| `rank` | rank | |
| `createdBy` | uuid | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### spaceMembers
scope: space · write: admin · bootstrap: yes · indexes: spaceId, userId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | уникально (spaceId, userId) |
| `spaceId` | uuid | |
| `userId` | uuid | |
| `role` | enum(admin,member,guest) | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### projects
scope: space · write: member · bootstrap: yes · indexes: spaceId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `name` | text | 1–100 |
| `key` | text | `^[A-Z][A-Z0-9]{1,9}$`, уникален в инстансе (нарушение → `conflict`) |
| `description` | doc? | |
| `color` | text? | |
| `icon` | text? | |
| `leadId` | uuid? | |
| `rank` | rank | |
| `archivedAt` | ts? | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

Только в БД: `task_counter integer not null default 0`.

#### statuses
scope: space · write: admin · bootstrap: yes · indexes: spaceId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `name` | text | |
| `category` | enum(backlog,todo,in_progress,done,cancelled) | |
| `color` | text | |
| `rank` | rank | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### tasks
scope: space · write: member · bootstrap: yes · indexes: spaceId, projectId, parentId, statusId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | = `projects.spaceId` |
| `projectId` | uuid | только проект того же пространства |
| `number` | int? | null у клиента до ответа сервера; ключ задачи = `${project.key}-${number}`; уникально (projectId, number) |
| `parentId` | uuid? | подзадача |
| `statusId` | uuid | статус того же пространства |
| `title` | text | 1–500 |
| `description` | doc? | |
| `priority` | int | 0 нет, 1 срочно, 2 высокий, 3 средний, 4 низкий |
| `rank` | rank | ручной порядок |
| `dueDate` | date? | |
| `startDate` | date? | |
| `createdBy` | uuid | |
| `completedAt` | ts? | ставит мутатор при переходе в категорию done/cancelled, снимает при выходе |
| `fields` | obj | пользовательские поля (FT-1), по умолчанию `{}` |
| `createdAt` | ts | |
| `updatedAt` | ts | |

Сервер: запись `tasks` с `number = null` получает `number = ++projects.task_counter` (в той же транзакции). Смена `projectId` — мутатор ставит `number = null`.

#### taskAssignees
scope: space · write: member · bootstrap: yes · indexes: taskId, userId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | уникально (taskId, userId) |
| `spaceId` | uuid | |
| `taskId` | uuid | |
| `userId` | uuid | |
| `createdAt` | ts | |

#### taskWatchers
scope: space · write: guest · bootstrap: yes · indexes: taskId, userId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | уникально (taskId, userId); мутаторы добавляют и снимают только себя |
| `spaceId` | uuid | |
| `taskId` | uuid | |
| `userId` | uuid | |
| `createdAt` | ts | |

#### labels
scope: space · write: member · bootstrap: yes · indexes: spaceId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `name` | text | |
| `color` | text | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### taskLabels
scope: space · write: member · bootstrap: yes · indexes: taskId, labelId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | уникально (taskId, labelId) |
| `spaceId` | uuid | |
| `taskId` | uuid | |
| `labelId` | uuid | |
| `createdAt` | ts | |

#### checklistItems
scope: space · write: member · bootstrap: yes · indexes: taskId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `taskId` | uuid | |
| `text` | text | |
| `done` | bool | |
| `rank` | rank | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### comments
scope: space · write: guest · bootstrap: yes · indexes: taskId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `taskId` | uuid | |
| `authorId` | uuid | = ctx.userId; правит и удаляет только автор |
| `body` | doc | упоминание — узел `{type:'mention', attrs:{id:<userId>}}` |
| `mentions` | uuid[] | id из узлов mention, без повторов, по порядку появления |
| `editedAt` | ts? | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### commentReactions
scope: space · write: guest · bootstrap: yes · indexes: commentId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | уникально (commentId, userId, emoji) |
| `spaceId` | uuid | |
| `commentId` | uuid | |
| `userId` | uuid | = ctx.userId; мутатор ставит и снимает только свои |
| `emoji` | text | 1–32 символа (один эмодзи или короткий код) |
| `createdAt` | ts | |

#### attachments
scope: space · write: member · bootstrap: yes · indexes: taskId, commentId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `taskId` | uuid | |
| `commentId` | uuid? | |
| `fileSha256` | text | hex, 64 символа; файл должен быть в `files` |
| `name` | text | имя для скачивания |
| `mime` | text | |
| `size` | int | байты |
| `width` | int? | для картинок |
| `height` | int? | |
| `uploadedBy` | uuid | |
| `createdAt` | ts | |

Сервер: `put` разрешён, только если есть строка `file_uploads(fileSha256, ctx.userId)` или файл уже приложен в этом пространстве; иначе `forbidden`.

#### activity
scope: space · write: server · bootstrap: no · indexes: taskId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `taskId` | uuid | без FK |
| `actorId` | uuid | |
| `kind` | enum(created,updated,deleted,assignee_added,assignee_removed,label_added,label_removed,commented) | |
| `changes` | obj | `updated`: `{<поле>: [старое, новое]}` без `updatedAt`, `rank`; `assignee_*`: `{userId}`; `label_*`: `{labelId}`; `commented`: `{commentId}`; иначе `{}` |
| `createdAt` | ts | |

Пишет серверный `Tx` при записи `tasks`, `taskAssignees`, `taskLabels`, `comments` (создание). История — `GET /api/tasks/:id/activity` (C-http).

#### notifications
scope: user · write: self · bootstrap: yes · indexes: taskId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `userId` | uuid | получатель |
| `spaceId` | uuid | для группировки; на видимость не влияет |
| `kind` | enum(assigned,mentioned,commented,status_changed) | |
| `taskId` | uuid | без FK |
| `commentId` | uuid? | без FK |
| `actorId` | uuid | |
| `readAt` | ts? | |
| `createdAt` | ts | |

Создаёт сервер (CR-7) через серверный `Tx` от имени системы; пользователь мутаторами только читает (`readAt`) и удаляет свои. В bootstrap — последние 200 по `createdAt`.

Триггеры (серверный хук в транзакции мутации, после `run`; автор действия себя не уведомляет; получатель должен быть участником пространства):
- `assigned` — новому исполнителю (`taskAssignees` put);
- `mentioned` — каждому из `comments.mentions` (создание и правка — только новым упомянутым);
- `commented` — наблюдателям задачи при новом комментарии, кроме упомянутых в нём;
- `status_changed` — наблюдателям при смене `tasks.statusId`.

Автоподписка (тот же хук, `taskWatchers` от имени системы): автор задачи, назначенный исполнитель, автор комментария. Push — задача pg-boss на каждое уведомление после коммита.

#### savedViews
scope: space|user · write: member|self · bootstrap: yes · indexes: spaceId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `userId` | uuid? | не null — личный вид (видит только владелец), null — общий для пространства |
| `createdBy` | uuid | |
| `name` | text | |
| `layout` | text | `list`, `board` или id вида модуля |
| `filter` | obj | |
| `config` | obj | группировка, сортировка, колонки |
| `rank` | rank | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### settings
scope: global · write: instance_admin · bootstrap: yes · indexes: —

| поле | тип | примечание |
|---|---|---|
| `id` | text | ключ |
| `value` | json | |
| `updatedAt` | ts | |

Ключи v1: `enabled_modules` — `string[]` id модулей. Секреты (VAPID и т. п.) в `settings` не кладём — только env.

### Несинхронизируемые таблицы (только сервер)
| таблица | колонки |
|---|---|
| `sessions` | `id text pk` (sha256 hex токена из cookie), `user_id uuid`, `created_at`, `expires_at`, `last_seen_at timestamptz`, `user_agent text?` |
| `files` | `sha256 text pk`, `size bigint`, `mime text`, `width int?`, `height int?`, `created_by uuid`, `created_at` |
| `push_subscriptions` | `id uuid pk`, `user_id uuid`, `endpoint text unique`, `p256dh text`, `auth text`, `user_agent text?`, `created_at` |
| `client_mutations` | `client_id uuid pk`, `user_id uuid`, `last_mutation_id bigint not null`, `updated_at` |
| `changes` | `seq bigserial pk`, `space_id uuid?`, `user_id uuid?`, `entity text`, `id text`, `op text check (put,del)`, `data jsonb?`, `created_at`; индексы `(space_id, seq)`, `(user_id, seq)` |
| `file_uploads` | `sha256 text`, `user_id uuid`, `created_at`; первичный ключ (sha256, user_id) — кто загружал файл (дубли контента — одна строка files) |
| `login_attempts` | `key text pk` (ip и login через «\|»), `attempts int`, `window_started_at timestamptz` — окно 1 мин для лимита входа |
| `api_tokens` | `id uuid pk`, `user_id uuid`, `name text`, `token_sha256 text unique`, `prefix text`, `scope text check (read,write)`, `expires_at?`, `last_used_at?`, `revoked_at?`, `created_at` |

Миграции — drizzle-kit, каталог `apps/api/drizzle/`, схема — `apps/api/src/db/schema.ts` (+ схемы модулей `modules/*/api/schema.ts`, таблицы с префиксом `<moduleId>_`).

## C-sync v1

Транспорт — JSON поверх HTTP, авторизация — сессия (C-http) или Bearer. Ошибки уровня запроса — формат C-http (`401 unauthenticated`, `400 invalid_request`, `413 payload_too_large`, `500 internal`).

### Журнал `changes`
- Каждая запись серверного `Tx` добавляет строку: `put` — с полной строкой в `data` (провод, camelCase), `del` — `data = null`. `patch` тоже даёт `put` с полной строкой.
- Колонки видимости по `scope`: `space` → `space_id = row.spaceId` (у `spaces` — `row.id`), `user_id = null`; `user` → `space_id = null`, `user_id = row.userId`; `global` → обе null.
- **Порядок.** Транзакция, пишущая в `changes`, первой записью берёт `pg_advisory_xact_lock(7311)`; так порядок `seq` совпадает с порядком коммитов и pull не пропускает строки.
- В той же транзакции — `SELECT pg_notify('planar_changes', '<max seq>')`: только номер.
- **Сброс.** Добавление или удаление участника пространства → строка `entity = '_reset'`, `op = 'put'`, `id = <userId>`, `user_id = <userId>`. Смена `settings.enabled_modules` → `_reset` с обеими колонками null (для всех).

### `GET /sync/bootstrap?clientId=<uuid>`
Один снимок `REPEATABLE READ`. `cursor` = `max(seq)` журнала (0 — пусто). `lastMutationId` — из `client_mutations` для `clientId` (0 — нет записи). `data` — все сущности с `bootstrap: yes`, видимые пользователю, включённых модулей; ключ есть у каждой такой сущности, даже пустой.

```json example=sync.bootstrap
{
  "cursor": 1042,
  "lastMutationId": 17,
  "data": {
    "spaces": [{"id": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b", "name": "Продукт", "description": null, "color": null, "icon": null, "rank": "a0", "createdBy": "0192b3c4-0000-7000-8000-000000000001", "createdAt": "2026-10-22T10:00:00.000Z", "updatedAt": "2026-10-22T10:00:00.000Z"}],
    "tasks": []
  }
}
```

```json bad=sync.bootstrap
{"cursor": "1042", "lastMutationId": 17, "data": {}}
```

### `GET /sync/pull?cursor=<int>&clientId=<uuid>`
Один снимок `REPEATABLE READ`. `changes` — видимые пользователю строки с `seq > cursor`, по возрастанию `seq`, только включённых модулей. Ответный `cursor` = `max(seq)` журнала (не только видимых). `reset: true` (и `changes: []`), если: среди видимых строк есть `_reset`; `cursor` больше `max(seq)` или меньше минимального хранимого `seq - 1`; видимых строк больше 5000. Клиент на `reset` делает bootstrap заново.

```json example=sync.pull
{
  "cursor": 1050,
  "lastMutationId": 18,
  "changes": [
    {"seq": 1043, "entity": "taskLabels", "id": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7c", "op": "put", "data": {"id": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7c", "spaceId": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b", "taskId": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7d", "labelId": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7e", "createdAt": "2026-10-22T10:05:00.000Z"}},
    {"seq": 1049, "entity": "labels", "id": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7f", "op": "del"}
  ]
}
```

```json example=sync.pull
{"cursor": 1050, "lastMutationId": 18, "changes": [], "reset": true}
```

```json bad=sync.pull
{"cursor": 1050, "lastMutationId": 18, "changes": [{"seq": 1043, "entity": "tasks", "id": "x", "op": "patch", "data": {}}]}
```

### `POST /sync/push`
Тело ≤ 1 МБ, мутаций ≤ 100. `mutations[].id` — целое > 0, растёт на клиенте (`clientId` — uuidv7, создаётся вместе с локальной базой).
- Мутации выполняются по порядку, каждая в своей транзакции: проверка `args` по zod мутатора → `run(serverTx, args, ctx)` → `client_mutations.last_mutation_id = id` → коммит.
- `id ≤ last_mutation_id` — уже обработана: не выполняется, результат `{id, ok: true}`.
- Отклонённая мутация (`MutatorError`, ошибка zod, неизвестное имя, любое исключение внутри `run`): транзакция откатывается, затем отдельной транзакцией `last_mutation_id = id`; результат `{id, ok: false, code, message}`. Клиент убирает её из очереди.
- Сбой инфраструктуры (БД недоступна, ошибка коммита) — ответ `500` целиком; уже закоммиченные мутации идемпотентны при повторе.
- `clientId` принадлежит первому пользователю, который его прислал; чужой → `403 forbidden`.
- Коды результата: `invalid_args`, `forbidden`, `not_found`, `conflict`, `unknown_mutator`, `internal`.

```json example=sync.pushRequest
{"clientId": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a80", "mutations": [{"id": 18, "name": "task.update", "args": {"id": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7d", "title": "Новый заголовок"}}]}
```

```json bad=sync.pushRequest
{"clientId": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a80", "mutations": [{"id": 0, "name": "task.update", "args": {}}]}
```

```json example=sync.pushResponse
{"results": [{"id": 18, "ok": true}, {"id": 19, "ok": false, "code": "forbidden", "message": "нет прав на пространство"}]}
```

```json bad=sync.pushResponse
{"results": [{"id": 19, "ok": false, "code": "oops"}]}
```

### WebSocket `/ws`
Авторизация — cookie сессии при upgrade (плюс проверка Origin, C-http); без сессии — закрытие с кодом 4401. Сервер слушает `LISTEN planar_changes` одним соединением и шлёт всем подключённым `{t:'poke', seq}` (можно склеивать пачки не дольше 50 мс; seq — последний). Клиент после подключения шлёт `{t:'hello', cursor}`; если `max(seq) > cursor`, сервер сразу отвечает `poke`. На `poke` с `seq > cursor` клиент делает pull. Пинг — WS ping/pong раз в 30 с. Данные по WS не передаются.

```json example=ws.server
{"t": "poke", "seq": 1050}
```

```json example=ws.client
{"t": "hello", "cursor": 1042}
```

```json bad=ws.server
{"t": "poke"}
```

### Клиент (для web)
Применяет `changes` по `seq`; `reset` → bootstrap. После pull отбрасывает из очереди мутации с `id ≤ lastMutationId`, остальные заново применяет поверх серверного состояния (rebase). Повтор push при сетевой ошибке и `5xx` — с ростом паузы 1–30 с; `401` — на вход.

## C-mutators v2

Код — `packages/shared/src/contract/mutator.ts` (типы и регистрация), домен — `packages/shared/src/mutators/` (CR-5). Без Node API: тот же код идёт в браузер.

```ts
export type EntityName = keyof typeof entitySchemas;
export type Row<E extends EntityName> = z.output<(typeof entitySchemas)[E]>;

export interface MutatorCtx { userId: string; now: string /* ISO ts */; server: boolean }

export interface Tx {
  get<E extends EntityName>(entity: E, id: string): Promise<Row<E> | undefined>;
  put<E extends EntityName>(entity: E, row: Row<E>): Promise<void>;          // вставка или полная замена
  patch<E extends EntityName>(entity: E, id: string, partial: Partial<Row<E>>): Promise<void>; // нет строки → MutatorError('not_found')
  del<E extends EntityName>(entity: E, id: string): Promise<void>;           // нет строки → ничего
  scan<E extends EntityName>(entity: E, opts?: { index: string; eq: unknown }): Promise<Row<E>[]>; // порядок не гарантирован
}

export interface MutatorDef<A extends z.ZodType = z.ZodType> {
  name: string; args: A; run(tx: Tx, args: z.output<A>, ctx: MutatorCtx): Promise<void>;
}
export function defineMutator<A extends z.ZodType>(def: MutatorDef<A>): MutatorDef<A>; // возвращает def как есть
export function createRegistry(defs: MutatorDef[]): Map<string, MutatorDef>;          // дубль имени → throw

export type MutationErrorCode = 'invalid_args' | 'forbidden' | 'not_found' | 'conflict';
export class MutatorError extends Error { constructor(public code: MutationErrorCode, message: string) }
export function uuidv7(): string; // RFC 9562, crypto.getRandomValues
```

### Правила
- `scan` с `index` не из `indexes` сущности → `throw Error` (во всех реализациях `Tx`). Без `opts` — все строки (только для малых сущностей: `users`, `settings`, `spaces`, `statuses`, `labels`).
- `put`/`patch` проверяют итоговую строку по `entitySchemas[entity]`; нарушение → `MutatorError('invalid_args')`.
- Мутатор детерминирован: все id создаваемых строк и `rank` приходят в `args` (их считает вызывающий: `uuidv7()`, `generateKeyBetween` из `fractional-indexing`). Время — только `ctx.now`. Ветвления по `ctx.server` — только чтобы не делать на клиенте то, что умеет лишь сервер.
- Update-мутаторы: поле отсутствует — не меняется, `null` — обнулить. Изменения по полям: при конфликте побеждает последняя запись на сервере.
- Удаление родителя — мутатор сначала удаляет дочерние строки (см. FK в C-schema).
- **Серверный `Tx`** (CR-4, `apps/api/src/sync/server-tx.ts`): поверх транзакции Drizzle, строки в формате провода. На каждую запись — проверка прав по `write` сущности (для `patch`/`del` и замены — по существующей строке, для `put` — и по новой); запрет → `MutatorError('forbidden')`. Затем строка в `changes`, для `tasks`/`taskAssignees`/`taskLabels`/`comments` — `activity` (C-schema). Нарушение уникальности (23505) → `conflict`, FK (23503) → `invalid_args`. Чтение (`get`/`scan`) прав не проверяет: мутаторы — доверенный код. Серверный код (CR-3, CR-7) пишет через тот же `Tx` с `ctx.userId` системы и обходом прав (`asSystem`), чтобы попасть в `changes`.
- **`MemoryTx`** (CR-5, `packages/shared/src/testing/memory-tx.ts`, экспорт `@planar/shared/testing`) — `new MemoryTx()`, та же семантика без прав, `changes`, `activity`; `get`/`scan` возвращают копии. Нужен web для тестов и как образец для Dexie.
- Набор тестов семантики `Tx` — `txContractSuite(name, setup)` из `packages/shared/test/tx-contract.ts`: обе реализации обязаны его проходить (MemoryTx — `packages/shared/test/memory-tx.test.ts`, CR-5; серверный — CR-4).

### Мутаторы домена v2
Таблица имён, args и правил — `docs/contracts/core-mutators.md` (часть C-mutators, версия — этого раздела).

## C-modules v1

Модуль — каталог `modules/<id>/` (`id` — `^[a-z][a-z0-9-]{1,30}$`):
- `shared/index.ts` — `export const shared: SharedModuleManifest = { id, mutators: MutatorDef[], entities: Record<string, {schema: ZodObject, meta: EntityMeta}> }` (без Node API; сущности — по правилам C-schema, имена с префиксом id модуля в camelCase);
- `api/index.ts` — `export const api: BackendModuleManifest = { id, nestModule, mutators, entities }` (`mutators`, `entities` — из `shared`); таблицы — `api/schema.ts`;
- `web/index.ts` — `export const web: FrontendModuleManifest = { id, routes?, views?, taskPanels?, commands?, fieldTypes?, settings? }`; типы элементов задаёт web (C-ui).

`EntityMeta` = строка сущности из C-schema: `{scope, write, bootstrap: boolean, indexes: string[]}`; встроенные — `ENTITIES`.

Включение — `settings.enabled_modules`. Выключенный модуль: его HTTP-маршруты отвечают `404 module_disabled`, его мутаторы — `unknown_mutator`, его сущности не попадают в bootstrap и pull. Загрузка всех модулей — при старте API (маршруты есть всегда, проверку делает guard); смена `enabled_modules` пишет `_reset` для всех.

## C-http v4

### Пути и окружение
- `/api/*` — REST, `/sync/*` — синхронизация, `/ws` — WebSocket, `/files/*` — файлы, `/mcp` — MCP (CR-11). В dev Vite проксирует их на api, в prod — Caddy.
- Env api: `DATABASE_URL`, `PORT` (3000), `PUBLIC_URL` (origin для проверки, напр. `http://localhost:5173`), `COOKIE_SECURE` (`true` в prod), `DATA_DIR` (`./data`, файлы — `$DATA_DIR/files/<ab>/<cd>/<sha256>`, ab и cd — первые 4 hex-символа), `MAX_UPLOAD_MB` (50), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `LOG_LEVEL`.
- JSON-тело ≤ 1 МБ, кроме загрузки файлов.

### Ошибки
Любой не-2xx ответ — JSON `{code, message, details?}`. `details` у `invalid_request` — `issues` из zod.

| статус | code |
|---|---|
| 400 | `invalid_request` |
| 401 | `unauthenticated`, `invalid_credentials` |
| 403 | `forbidden`, `origin_mismatch` |
| 404 | `not_found`, `module_disabled` |
| 409 | `conflict` |
| 413 | `payload_too_large` |
| 429 | `rate_limited` |
| 500 | `internal` |
| 503 | `unavailable` |

```json example=http.error
{"code": "invalid_request", "message": "Неверные данные", "details": [{"path": ["title"], "message": "Too small"}]}
```

```json bad=http.error
{"code": "teapot", "message": "?"}
```

### Сессия и Origin
- Cookie `planar_sid`: случайные 32 байта, base64url; `HttpOnly; SameSite=Lax; Path=/`, `Secure` при `COOKIE_SECURE=true`. В БД — только sha256 hex (`sessions.id`). Срок 30 дней, продлевается, когда осталось < 15.
- Небезопасные методы (POST, PUT, PATCH, DELETE) с cookie-авторизацией и upgrade `/ws`: заголовок `Origin` обязан совпасть с origin `PUBLIC_URL`, иначе `403 origin_mismatch` (нет заголовка — тоже отказ).
- `Authorization: Bearer plnr_<…>` (CR-10) даёт тот же `ctx.userId`; Origin не проверяется. Токен `read` — только GET и `/sync/bootstrap`, `/sync/pull`; иначе `403 forbidden`.
- Деактивированный пользователь — `401 unauthenticated` (сессии удаляются).

### Эндпоинты core
| метод и путь | вход → выход | задача |
|---|---|---|
| `GET /api/health` | → `200 {ok: true, db: 'up'}` \| `503 {ok: false, db: 'down'}` | CR-1 |
| `GET /api/setup` | → `200 {needed: boolean}` — `true`, пока нет ни одного пользователя; без авторизации | CR-3 |
| `POST /api/setup` | `{login, name, password}` → `201 {user}`; пользователи уже есть → `409 conflict` | CR-3 |
| `POST /api/auth/login` | `{login, password}` → `200 {user}` + cookie; `401 invalid_credentials`; > 10 попыток/мин на IP+login → `429` | CR-3 |
| `POST /api/auth/logout` | → `204`, cookie сброшен | CR-3 |
| `GET /api/auth/me` | → `{user}` \| `401` | CR-3 |
| `GET /api/users` | → `{users: user[]}` (instance_admin) | CR-3 |
| `POST /api/users` | `{login, name, password, role, email?}` → `201 {user}` (instance_admin) | CR-3 |
| `PATCH /api/users/:id` | `{name?, email?, role?, password?, deactivated?: bool, avatarFile?: string\|null}` → `{user}`; `avatarFile` — sha256 из `POST /files`, загруженного этим пользователем (`file_uploads`), иначе `400 invalid_request`; себя — только name, email, password, avatarFile | CR-3 |
| `GET /api/push/vapid` | → `{publicKey}` (VAPID, base64url) | CR-7 |
| `POST /api/push/subscribe` | `{endpoint, keys: {p256dh, auth}}` → `201`; повтор того же endpoint — обновление, `200` | CR-7 |
| `DELETE /api/push/subscribe` | `{endpoint}` → `204` (только свои) | CR-7 |
| `GET /api/modules` | → `{modules: [{id, enabled}]}` — все загруженные модули; включение — мутатор `settings.set` `enabled_modules` | CR-8 |
| `GET /api/tasks/:id/activity` | → `{rows: activity[]}` по `createdAt`, права — видимость задачи | CR-4 |
| `POST /files` | multipart, одно поле `file` → `201 {sha256, size, mime, width, height}`; > `MAX_UPLOAD_MB` → `413` | CR-6 |
| `GET /files/:sha256` | → поток; `?name=` для `Content-Disposition`; доступ: файл приложен в пространстве пользователя, или это аватар пользователя, или есть `file_uploads(sha256, userId)`; иначе `404` | CR-6 |
| `GET /files/:sha256/preview?w=256\|1024` | → `image/webp`; не картинка → `404` | CR-6 |

`user` в ответах — строка `users` (C-schema), без `password_hash`. Пароль — от 8 символов, argon2id.
