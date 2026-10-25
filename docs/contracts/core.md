---
type: contract
status: active
module: core
updated: 2026-10-23
summary: Контракты core — C-schema, C-sync, C-mutators, C-modules, C-http; версии в заголовках, примеры проверяет контрактный тест
related: ["docs/plan/core.md", "docs/roadmap.md", "docs/contracts/core-schema.md"]
contracts: [{"id": "C-schema", "version": 6}, {"id": "C-sync", "version": 1}, {"id": "C-mutators", "version": 3}, {"id": "C-modules", "version": 2}, {"id": "C-http", "version": 8}]
---

# Контракты модуля core

Владелец всех контрактов файла — координатор core. Меняет только он: версия +1 в заголовке и в `CONTRACT_VERSIONS`, потребителям — `task note`. C-sync и C-mutators после выдачи WB-2 — только через шлюз.

**Контрактный тест** — `packages/shared/test/contract.test.ts` (правит только координатор). Он сверяет с этим файлом:
- версии из заголовков `## C-… vN` = `CONTRACT_VERSIONS`;
- каждый блок ` ```json example=<имя> ` проходит `contractSchemas[<имя>]`, каждый ` ```json bad=<имя> ` — нет; у каждой схемы есть пример;
- сущности раздела «Сущности» (в `docs/contracts/core-schema.md`): имена, поля, nullability, строка `scope · write · bootstrap · indexes` = `entitySchemas` и `ENTITIES`.

Схема БД против этого файла — `apps/api/test/contract.schema.test.ts` (появится до CR-2).

Код контрактов — `packages/shared/src/contract/` (экспорт из `packages/shared/src/index.ts`, без Node API): `CONTRACT_VERSIONS`, `contractSchemas`, `entitySchemas`, `ENTITIES`, типы `Tx`, `MutatorCtx`, `MutatorDef`, функции `defineMutator`, `createRegistry`, класс `MutatorError`, `uuidv7()`.

## C-schema v11

v11 (комментарии): `comments.parentId` (треды), `assigneeId`, `resolvedAt`, `resolvedBy`; `notifications.kind` += `comment_assigned` (исполнителю назначенного комментария).

v10 (Входящие как в ClickUp): `notifications.changes` — что изменилось (`status_changed`: `{statusId: [старый, новый]}`).

v9 (p3, PT-1): несинхронизируемая таблица `ydocs` — состояние Y.Doc совместного редактирования (`docs/contracts/p3.md` §P3-ydoc).

v8 (CL-1a): `notifications` для чата; scope `space|members`.

v7 (WK-0): `tasks.cycleId` (work.md).
v6 (FT): `fieldDefs`, `taskLinks`, формат `tasks.fields` (features.md).

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
- `scope` — кто видит строку (bootstrap, pull): `space` — участники пространства `spaceId` (у `spaces` — `id`); `user` — только `userId`; `global` — все вошедшие; `space|user` — `user`, если `userId` не null, иначе `space`. `space|members` (C-sync v2) — `space`, если `spaceId` задан, иначе участники контейнера по `meta.members` (`docs/contracts/collab.md` §X-core п. 1).
- `write` — минимальная роль для записи через серверный `Tx`: `guest` < `member` < `admin` — роль в `spaceMembers` этого пространства; `self` — `row.userId = ctx.userId`; `instance_admin` — `users.role` ∈ {owner, admin}; `server` — только серверный код, мутаторам запрещено; `member|self` — по `scope` строки.
- Создание пространства (`put` в `spaces` новой строки) разрешено любому с `users.role` ≠ guest; в той же транзакции он может создать себе `spaceMembers` с ролью admin.
- `bootstrap` — входит ли сущность в `GET /sync/bootstrap` (`no` — только через pull и свой REST).
- `indexes` — поля, по которым разрешён `Tx.scan({index, eq})` (в Dexie это индексы; в БД — b-tree).

### Сущности

Сущности — docs/contracts/core-schema.md (часть C-schema v11).

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
| `ydocs` | `doc_id text pk` (имя документа docs:uuid или task:uuid), `state bytea not null` (Y.encodeStateAsUpdate), `updated_at timestamptz` — p3.md §P3-ydoc |

Миграции — drizzle-kit, каталог `apps/api/drizzle/`, схема — `apps/api/src/db/schema.ts` (+ схемы модулей `modules/*/api/schema.ts`, таблицы с префиксом `<moduleId>_`).

## C-sync v2

v2 (CL-1a): `space|members`, WS `typing` — `docs/contracts/collab.md` §X-core п. 1–2.

Транспорт — JSON поверх HTTP, авторизация — сессия (C-http) или Bearer. Ошибки уровня запроса — формат C-http (`401 unauthenticated`, `400 invalid_request`, `413 payload_too_large`, `500 internal`).

### Журнал `changes`
- Каждая запись серверного `Tx` добавляет строку: `put` — с полной строкой в `data` (провод, camelCase), `del` — `data = null`. `patch` тоже даёт `put` с полной строкой.
- Колонки видимости по `scope`: `space` → `space_id = row.spaceId` (у `spaces` — `row.id`), `user_id = null`; `user` → `space_id = null`, `user_id = row.userId`; `global` → обе null.
- **Порядок.** Транзакция, пишущая в `changes`, первой записью берёт `pg_advisory_xact_lock(7311)`; так порядок `seq` совпадает с порядком коммитов и pull не пропускает строки. v2: серверный `Tx` мутации берёт его до первого `get`/`scan` (мутации сериализуются: чтение-затем-запись — `docs.lock`, `lastSeq` чата — без гонок).
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

## C-mutators v7

v7 (комментарии): `comment.create` += `parentId?`, `assigneeId?`; `comment.assign`, `comment.resolve`; `comment.delete` корня — с тредом — core-mutators.md.

v6 (группы): `project.create` в корневом пространстве (`settings.root_space`, уровень «Воркспейс»; создаёт и наполняет участниками `apps/api/src/spaces/root.ts`) → `invalid_args` — core-mutators.md.

v5 (p4, PF-4): `settings.set {id: 'enabled_modules'}` — новый id модуля с `unavailable` ≠ null → `invalid_args` (только сервер) — p4.md, core-mutators.md.

v4 (design): `space.create` += `statusNames?` (core-mutators.md).
v3 (FT): `field.*`, `task.setField`, `link.*` (core-mutators.md).

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

## C-modules v12

v12 (группы): `FrontendModuleManifest.groupTabs?` — `GroupTabDef {id, tab: inbox|docs|chats|reports|settings, label?, icon?, order?, component}`; компонент получает `scope: GroupScope {level: workspace|space|project, spaceId, projectId, rootSpaceId}` (у Воркспейса `spaceId` — корневое пространство) и показывает данные уровня группы и вложенных; несколько вкладов в один таб — подтабы (`?r=<moduleId>:<id>`). SDK += `useGroupLevels(scope)` — уровни группы сверху вниз (`apps/web/src/layout/groups.ts`). `SettingsPageDef.level?` (workspace по умолчанию | space | project) — уровень настроек группы; страница получает `spaceId` и `projectId`. Секции `nav` модулей docs, chat, time, import, dashboards, workload, goals убраны — их место в дереве групп; точка `nav` — для прочих модулей. SDK += `groupUrl`, `GroupProjectPick`.
v11 (p4): `BackendModuleManifest.unavailable?`, `GET /api/modules` += `unavailable`; `/api/<id>/setup/*` выключенного модуля — только owner/admin (ModuleGuard); `FrontendModuleManifest.setup?`; `CommandDef.newTaskMenu?` — docs/contracts/p4.md (вступление).
v10 (design, DS-0): SDK += компоненты C-ui v3 — work-api.md, design.md.
v9 (p3, PT-5): `CoreServices` += `execute(userId, muts, opts?)` — как `JobApi.execute`; `ensureSystemUser(login, name): Promise<string>` — деактивированный пользователь без пароля (как «Автоматизация»), повторный вызов возвращает того же; `storeFile(buf: Buffer, uploaderId: string): Promise<{sha256, size, mime, width, height}>` — та же запись, что `POST /files` (`files`, `file_uploads`, лимит `MAX_UPLOAD_MB` → `413`).
v8: JobApi.execute opts.after — в транзакции после всех мутаций, ошибка откатывает (PL-2) — work.md §C-modules v4.
v7: перечень SDK (sendTyping/onTyping с C-sync v2) — work-api.md.
v3–v6 (work, владелец C-modules): хуки, server-kit, SDK, настройки, правки collab — work.md, work-api.md.

Модуль — каталог `modules/<id>/` (`id` — `^[a-z][a-z0-9-]{1,30}$`):
- `shared/index.ts` — `export const shared: SharedModuleManifest = { id, mutators: MutatorDef[], entities: Record<string, {schema: ZodObject, meta: EntityMeta}> }` (без Node API; сущности — по правилам C-schema, имена с префиксом id модуля в camelCase);
- `api/index.ts` — `export const api: BackendModuleManifest = { id, nestModule, mutators, entities }` (`mutators`, `entities` — из `shared`); таблицы — `api/schema.ts`;
- `web/index.ts` — `export const web: FrontendModuleManifest = { id, routes?, views?, taskPanels?, commands?, fieldTypes?, settings? }`; типы элементов задаёт web (C-ui).

`EntityMeta` = строка сущности из C-schema: `{scope, write, bootstrap: boolean, indexes: string[]}`; встроенные — `ENTITIES`.

HTTP-маршруты модуля — только под `/api/<id>/` (по префиксу их находит guard включения). Реестр api-модулей — `apps/api/src/modules/installed.ts` (строка на модуль); пакет модуля — `@planar/module-<id>` в workspace. Сущности модуля в `Tx` — через приведение имени к `EntityName` (типы `Tx` знают только ядро).

Включение — `settings.enabled_modules`. Выключенный модуль: его HTTP-маршруты отвечают `404 module_disabled`, его мутаторы — `unknown_mutator`, его сущности не попадают в bootstrap и pull. Загрузка всех модулей — при старте API (маршруты есть всегда, проверку делает guard); смена `enabled_modules` пишет `_reset` для всех.

## C-http v12

v12 (ops): `GET /api/health/ready`, `GET /api/metrics` (docs/contracts/ops.md).

v11 (p3): WS `/collab` (Hocuspocus; cookie и Origin — как `/ws`; `docs/contracts/p3.md` §P3-collab); env `PLANAR_SECRET_KEY`, `TRUST_PROXY`; вход `/f/*` — отдельная HTML-страница публичных форм (§P3-forms).

v10 (CL-1a): `GET /files` и push без задачи — collab.md §X-core п. 3–4.

v9 (WK-0): `cycleId` в REST v1; пути WK-5 — work.md.
v8 (FT): поля в REST v1 и MCP (core-api-v1.md).

### Пути и окружение
- `/api/*` — REST, `/sync/*` — синхронизация, `/ws` — WebSocket, `/files/*` — файлы, `/mcp` — MCP (CR-11), `/collab` — WebSocket совместного редактирования (v11), `/f/*` — страница публичной формы, отдельный HTML-вход web без приложения (v11). В dev Vite проксирует их на api, в prod — Caddy.
- Env api: `DATABASE_URL`, `PORT` (3000), `PUBLIC_URL` (origin для проверки, напр. `http://localhost:5173`), `COOKIE_SECURE` (`true` в prod), `DATA_DIR` (`./data`, файлы — `$DATA_DIR/files/<ab>/<cd>/<sha256>`, ab и cd — первые 4 hex-символа), `MAX_UPLOAD_MB` (50), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `LOG_LEVEL`, `PLANAR_SECRET_KEY` (v11; 32 байта в base64 — ключ AES-256-GCM секретов модулей, напр. токена GitLab; не задан — функции с секретами отвечают `503 unavailable`). `TRUST_PROXY` (v11) — IP/CIDR доверенных прокси через запятую (Fastify `trustProxy` списком, не `true`); пусто — выкл.: `req.ip` — адрес соединения. Задан — `req.ip` из `X-Forwarded-For` только от адресов списка. Prod `compose.yml`: фиксированная подсеть сети Caddy, порт api наружу не публикуется. По `req.ip` считаются лимит входа и лимит публичных форм.
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
- `Authorization: Bearer plnr_<…>` (CR-10) даёт тот же `ctx.userId`; Origin не проверяется. Токен `read` — только GET и `/sync/bootstrap`, `/sync/pull`; иначе `403 forbidden`. Токены, REST `/api/v1` и MCP `/mcp` — `docs/contracts/core-api-v1.md` (часть C-http).
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

### Web Push
Формат тела push — `docs/contracts/core-api-v1.md` §Web Push (часть C-http).

