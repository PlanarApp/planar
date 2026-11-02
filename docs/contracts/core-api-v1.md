---
type: reference
status: closed
module: core
updated: 2026-11-02
summary: API tokens, Bearer, REST /api/v1 and MCP /mcp — part of C-http v8 (docs/contracts/core.md); examples are checked by the contract test
related: ["docs/contracts/core.md", "docs/contracts/core-mutators.md"]
---

# API v1: tokens, REST, MCP (part of C-http v8)

The version is the heading `## C-http vN` in `docs/contracts/core.md`. The ` ```json example=…/bad=… ` blocks of this file are checked by `packages/shared/test/contract.test.ts` against `contractSchemas`.

## Tokens (CR-10)
- Format: `plnr_` + 32 random bytes in base62 (43 characters). `api_tokens` stores only `token_sha256` (hex of the full string) and `prefix` (the first 8 characters after `plnr_`, for display).
- `scope`: `read` — GET only (REST, `/sync/bootstrap`, `/sync/pull`), read MCP tools; `write` — everything the owner can do. Space permissions are those of the token owner (the same `ctx.userId`).
- A revoked (`revoked_at`), expired (`expires_at` ≤ now) or unknown token, or a deactivated owner → `401 unauthenticated`. `last_used_at` is updated at most once a minute.
- Token management — by session (cookie) only; a request with Bearer to `/api/tokens*` → `403 forbidden`.
- A write through a token is marked: `activity.viaTokenId` = the token id (C-schema v5, arrives with CR-10a); for session writes — `null`.

| method and path | input → output |
|---|---|
| `GET /api/tokens` | → `{tokens: apiToken[]}` — own, newest first |
| `POST /api/tokens` | `{name (1–100), scope, expiresAt?: ts\|null}` → `201 {token: apiToken, secret: 'plnr_…'}`; `secret` is shown only here |
| `DELETE /api/tokens/:id` | → `204`; sets `revoked_at` (own only, otherwise `404`) |

```json example=api.tokenCreated
{"token": {"id": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6b01", "name": "CI", "prefix": "a1B2c3D4", "scope": "write", "expiresAt": null, "lastUsedAt": null, "revokedAt": null, "createdAt": "2026-10-23T06:00:00.000Z"}, "secret": "plnr_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8s9T0u1V"}
```

```json bad=api.tokenCreated
{"token": {"id": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6b01", "name": "CI", "prefix": "a1B2c3D4", "scope": "admin", "expiresAt": null, "lastUsedAt": null, "revokedAt": null, "createdAt": "2026-10-23T06:00:00.000Z"}, "secret": "plnr_x"}
```

## REST `/api/v1` (CR-10)
- Authorization — Bearer or session. Errors use the C-http format; mutator errors: `invalid_args` → 400 `invalid_request`, `forbidden` → 403, `not_found` → 404, `conflict` → 409.
- Writes use the same domain mutators (`docs/contracts/core-mutators.md`) through the server `Tx`, one transaction per request, with the notification hook; ids and `rank` are created by the server (`rank` — after the last task of the status). `client_mutations` is not used.
- Lists: `?limit` 1–200 (default 50), `?cursor` — an opaque string from `nextCursor`; order — `updatedAt` descending, then `id`. Response `{data: [...], nextCursor: string|null}`, a single entity — `{data: {...}}`.
- `task` in REST is a `tasks` row (C-schema) + `key` (`PLN-12` or `null` while there is no number), `assigneeIds: uuid[]`, `labelIds: uuid[]`. `:task` in the path is an id or a key.
- OpenAPI 3.1 — `GET /api/v1/openapi.json`, built from the same zod schemas (`z.toJSONSchema`).

| method and path | input → output |
|---|---|
| `GET /api/v1/spaces` | → list of the user's spaces |
| `GET /api/v1/projects?spaceId=` | → list of projects (visible ones) |
| `GET /api/v1/projects/:id/fields` | → `{data: fieldDefs[]}` by `rank` (no pagination); project not visible → 404 |
| `GET /api/v1/tasks?projectId=&statusId=&assigneeId=&updatedAfter=` | → list of tasks; `assigneeId=me` — the current user |
| `GET /api/v1/tasks/:task` | → task; not visible → 404 |
| `POST /api/v1/tasks` | `{projectId, title, statusId?, description?: string, priority?, dueDate?, assigneeIds?, labelIds?, parentId?}` → `201` task; `statusId` defaults to the first by `rank` status of the category `todo`, otherwise `backlog`; `description` — text via `textToDoc` |
| `PATCH /api/v1/tasks/:task` | `{title?, statusId?, priority?, dueDate?, startDate?, description?: string\|null, assigneeIds?, labelIds?, parentId?, fields?: {<fieldId>: value \| null}}` → task; `assigneeIds`/`labelIds` — full replacement of the list; `fields` — per key via `task.setField` (`null` — remove), the other task keys are unchanged |
| `GET /api/v1/tasks/:task/comments` | → list of the task's comments (by `createdAt` ascending) |
| `POST /api/v1/tasks/:task/comments` | `{text}` → `201` comment; `text` — via `textToDoc` (`@login` → mention) |

```json example=api.v1.task
{"data": {"id": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7d", "spaceId": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b", "projectId": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6b02", "number": 12, "parentId": null, "statusId": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6b03", "title": "Починить вход", "description": null, "priority": 2, "rank": "a0", "dueDate": null, "startDate": null, "createdBy": "0192b3c4-0000-7000-8000-000000000001", "completedAt": null, "fields": {}, "cycleId": null, "createdAt": "2026-10-23T06:00:00.000Z", "updatedAt": "2026-10-23T06:00:00.000Z", "key": "PLN-12", "assigneeIds": [], "labelIds": []}}
```

```json bad=api.v1.task
{"data": {"id": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7d", "title": "без полей"}}
```

## MCP `/mcp` (CR-11)
- Streamable HTTP (`@modelcontextprotocol/sdk`), no MCP sessions on the server (stateless: each POST has its own transport). Entry — a Bearer token only; without it → `401`.
- Tools (inputs — zod, output — `content: [{type:'text', text: JSON}]`, compact JSON of the same shapes as REST v1, without whole `description` documents: `description` → text):
  - read: `list_spaces {}`, `list_projects {spaceId?}`, `search_tasks {query?, projectId?, statusId?, assigneeId?, limit?}` (search by `title` and `key`, case-insensitive), `get_task {task}` (id or key, with comments), `my_tasks {includeDone?: bool}` (assigned to me; by default without done/cancelled), `list_fields {projectId}` (the project's field definitions, like REST `GET /api/v1/projects/:id/fields`);
  - write (needs `write`): `create_task` (as `POST /api/v1/tasks`), `update_task {task, …, fields?}` (as `PATCH`, including `fields`), `add_comment {task, text}`.
- Permission and data errors are a tool result with `isError: true` and the text `{code, message}` (C-http codes), not HTTP 500. A `read` token writing → `isError`, `code: 'forbidden'`.

## Web Push (part of C-http, moved from core.md)
The body of a push message (CR-7 → the web service worker) is JSON: `title` (by kind, e.g. "You were assigned"), `body` (the task title), `url` — an in-app path `/t/<KEY>-<number>` (starts with `/` but not with `//` and not with `/\`), `tag` — the notification id (the SW replaces a display with the same tag), `kind` — as `notifications.kind`. The body contains no data of other spaces.

```json example=push.payload
{"title": "Вас назначили", "body": "Починить вход", "url": "/t/PLN-12", "tag": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a90", "kind": "assigned"}
```

```json example=push.payload
{"title": "Личное сообщение", "body": "Анна: созвонимся в 15:00?", "url": "/m/chat/c/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a91/0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a92", "tag": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a93", "kind": "chat_dm"}
```

```json bad=push.payload
{"title": "Вас назначили", "body": "x", "url": "https://evil.example/t/1", "tag": "n1", "kind": "assigned"}
```

```json bad=push.payload
{"title": "Вас назначили", "body": "x", "url": "//evil.example/t/1", "tag": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a90", "kind": "assigned"}
```

```json bad=push.payload
{"title": "Вас назначили", "body": "x", "url": "/\\evil.example/t/1", "tag": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a90", "kind": "assigned"}
```
