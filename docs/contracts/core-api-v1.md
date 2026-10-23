---
type: reference
status: active
module: core
updated: 2026-10-23
summary: API-токены, Bearer, REST /api/v1 и MCP /mcp — часть C-http v7 (docs/contracts/core.md); примеры проверяет контрактный тест
related: ["docs/contracts/core.md", "docs/contracts/core-mutators.md"]
---

# API v1: токены, REST, MCP (часть C-http v7)

Версия — заголовок `## C-http vN` в `docs/contracts/core.md`. Блоки ` ```json example=…/bad=… ` этого файла проверяет `packages/shared/test/contract.test.ts` по `contractSchemas`.

## Токены (CR-10)
- Формат: `plnr_` + 32 случайных байта в base62 (43 символа). В `api_tokens` — только `token_sha256` (hex от полной строки) и `prefix` (первые 8 символов после `plnr_`, для показа).
- `scope`: `read` — только GET (REST, `/sync/bootstrap`, `/sync/pull`), MCP-инструменты на чтение; `write` — всё, что может владелец. Права пространств — как у владельца токена (тот же `ctx.userId`).
- Отозванный (`revoked_at`), просроченный (`expires_at` ≤ now) или неизвестный токен, деактивированный владелец → `401 unauthenticated`. `last_used_at` обновляется не чаще раза в минуту.
- Управление токенами — только по сессии (cookie); запрос с Bearer к `/api/tokens*` → `403 forbidden`.
- Запись через токен помечается: `activity.viaTokenId` = id токена (C-schema v5, приходит с CR-10a); у записей по сессии — `null`.

| метод и путь | вход → выход |
|---|---|
| `GET /api/tokens` | → `{tokens: apiToken[]}` — свои, новые сверху |
| `POST /api/tokens` | `{name (1–100), scope, expiresAt?: ts\|null}` → `201 {token: apiToken, secret: 'plnr_…'}`; `secret` показывается только здесь |
| `DELETE /api/tokens/:id` | → `204`; ставит `revoked_at` (только свой, иначе `404`) |

```json example=api.tokenCreated
{"token": {"id": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6b01", "name": "CI", "prefix": "a1B2c3D4", "scope": "write", "expiresAt": null, "lastUsedAt": null, "revokedAt": null, "createdAt": "2026-10-23T06:00:00.000Z"}, "secret": "plnr_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0u1V"}
```

```json bad=api.tokenCreated
{"token": {"id": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6b01", "name": "CI", "prefix": "a1B2c3D4", "scope": "admin", "expiresAt": null, "lastUsedAt": null, "revokedAt": null, "createdAt": "2026-10-23T06:00:00.000Z"}, "secret": "plnr_x"}
```

## REST `/api/v1` (CR-10)
- Авторизация — Bearer или сессия. Ошибки — формат C-http; ошибки мутаторов: `invalid_args` → 400 `invalid_request`, `forbidden` → 403, `not_found` → 404, `conflict` → 409.
- Запись — те же мутаторы домена (`docs/contracts/core-mutators.md`) через серверный `Tx` одной транзакцией на запрос, с хуком уведомлений; id и `rank` создаёт сервер (`rank` — после последней задачи статуса). `client_mutations` не используется.
- Списки: `?limit` 1–200 (по умолчанию 50), `?cursor` — непрозрачная строка из `nextCursor`; порядок — `updatedAt` по убыванию, затем `id`. Ответ `{data: [...], nextCursor: string|null}`, одна сущность — `{data: {...}}`.
- `task` в REST — строка `tasks` (C-schema) + `key` (`PLN-12` или `null`, пока нет номера), `assigneeIds: uuid[]`, `labelIds: uuid[]`. `:task` в пути — id или key.
- OpenAPI 3.1 — `GET /api/v1/openapi.json`, собирается из тех же zod-схем (`z.toJSONSchema`).

| метод и путь | вход → выход |
|---|---|
| `GET /api/v1/spaces` | → список пространств пользователя |
| `GET /api/v1/projects?spaceId=` | → список проектов (видимых) |
| `GET /api/v1/tasks?projectId=&statusId=&assigneeId=&updatedAfter=` | → список задач; `assigneeId=me` — текущий пользователь |
| `GET /api/v1/tasks/:task` | → задача; невидима → 404 |
| `POST /api/v1/tasks` | `{projectId, title, statusId?, description?: string, priority?, dueDate?, assigneeIds?, labelIds?, parentId?}` → `201` задача; `statusId` по умолчанию — первый по `rank` статус категории `todo`, иначе `backlog`; `description` — текст через `textToDoc` |
| `PATCH /api/v1/tasks/:task` | `{title?, statusId?, priority?, dueDate?, startDate?, description?: string\|null, assigneeIds?, labelIds?, parentId?}` → задача; `assigneeIds`/`labelIds` — полная замена списка |
| `GET /api/v1/tasks/:task/comments` | → список комментариев задачи (по `createdAt` возр.) |
| `POST /api/v1/tasks/:task/comments` | `{text}` → `201` комментарий; `text` — через `textToDoc` (`@login` → упоминание) |

```json example=api.v1.task
{"data": {"id": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7d", "spaceId": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b", "projectId": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6b02", "number": 12, "parentId": null, "statusId": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6b03", "title": "Починить вход", "description": null, "priority": 2, "rank": "a0", "dueDate": null, "startDate": null, "createdBy": "0192b3c4-0000-7000-8000-000000000001", "completedAt": null, "fields": {}, "createdAt": "2026-10-23T06:00:00.000Z", "updatedAt": "2026-10-23T06:00:00.000Z", "key": "PLN-12", "assigneeIds": [], "labelIds": []}}
```

```json bad=api.v1.task
{"data": {"id": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7d", "title": "без полей"}}
```

## MCP `/mcp` (CR-11)
- Streamable HTTP (`@modelcontextprotocol/sdk`), без сессий MCP на сервере (stateless: каждый POST — свой транспорт). Вход — только Bearer-токен; без него → `401`.
- Инструменты (входы — zod, выход — `content: [{type:'text', text: JSON}]`, компактный JSON тех же форм, что REST v1, без `description`-документов целиком: `description` → текст):
  - чтение: `list_spaces {}`, `list_projects {spaceId?}`, `search_tasks {query?, projectId?, statusId?, assigneeId?, limit?}` (поиск по `title` и `key`, без учёта регистра), `get_task {task}` (id или key, с комментариями), `my_tasks {includeDone?: bool}` (назначенные мне; по умолчанию без done/cancelled);
  - запись (нужен `write`): `create_task` (как `POST /api/v1/tasks`), `update_task {task, …}` (как `PATCH`), `add_comment {task, text}`.
- Ошибки прав и данных — результат инструмента с `isError: true` и текстом `{code, message}` (коды C-http), не HTTP 500. `read`-токен на запись → `isError`, `code: 'forbidden'`.
