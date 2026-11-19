---
type: reference
status: closed
module: core
updated: 2026-11-16
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
- `task` in REST is a `tasks` row (C-schema) + `key` (`PLN-12` or `null` while there is no number), `assigneeIds: uuid[]`, `labelIds: uuid[]`, `assignedComments: {total, resolved, assignedToMe}` (C-schema v30: assigned comments of the task itself, subtasks are not summed; `assignedToMe` — there is an open comment assigned to the caller; webhook and automation payloads have no caller — `false`). `:task` in the path is an id or a key.
- OpenAPI 3.1 — `GET /api/v1/openapi.json`, built from the same zod schemas (`z.toJSONSchema`).

| method and path | input → output |
|---|---|
| `GET /api/v1/spaces` | → list of the user's spaces |
| `GET /api/v1/projects?spaceId=` | → list of projects (visible ones) |
| `GET /api/v1/projects/:id/fields` | → `{data: fieldDefs[]}` by `rank` (no pagination); project not visible → 404 |
| `GET /api/v1/tasks?projectId=&statusId=&assigneeId=&updatedAfter=` | → list of tasks; `assigneeId=me` — the current user; for the current user (`me` or their id) also tasks with an open comment or checklist item assigned to them (as `search_tasks`/`my_tasks`) |
| `GET /api/v1/tasks/:task` | → task; not visible → 404 |
| `POST /api/v1/tasks` | `{projectId, title, statusId?, description?: string, priority?, dueDate?, assigneeIds?, labelIds?, parentId?}` → `201` task; `statusId` and `labelIds` must belong to `projectId` (statuses and labels belong to a project since C-schema v15, otherwise `400`); `statusId` defaults to the first by `rank` status of the project of the category `todo`, otherwise `backlog`; `description` — text via `textToDoc` |
| `PATCH /api/v1/tasks/:task` | `{title?, statusId?, priority?, dueDate?, startDate?, description?: string\|null, assigneeIds?, labelIds?, parentId?, fields?: {<fieldId>: value \| null}}` → task; `assigneeIds`/`labelIds` — full replacement of the list; `fields` — per key via `task.setField` (`null` — remove), the other task keys are unchanged |
| `GET /api/v1/tasks/:task/comments` | → list of the task's comments (by `createdAt` ascending) |
| `POST /api/v1/tasks/:task/comments` | `{text, parentId?, assigneeId?}` → `201` comment; `text` — via `textToDoc` (`@login` → mention); `parentId` — a reply to a comment of this task, `assigneeId` — assigned to a space member (PLNRAPP-186) |
| `PATCH /api/v1/comments/:id` | `{text?, assigneeId?: uuid \| null, resolved?: bool}` → comment (PLNRAPP-186); applied in that order via `comment.update` (author only), `comment.assign` (member; `null` — unassign; an assignment reopens), `comment.resolve` (the assignee, the author or admin; an unassigned comment → `400`); an invisible comment → `404` |

```json example=api.v1.task
{"data": {"id": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7d", "spaceId": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7b", "projectId": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6b02", "number": 12, "parentId": null, "statusId": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6b03", "title": "Починить вход", "description": null, "priority": 2, "rank": "a0", "dueDate": null, "startDate": null, "createdBy": "0192b3c4-0000-7000-8000-000000000001", "completedAt": null, "fields": {}, "cycleId": null, "createdAt": "2026-10-23T06:00:00.000Z", "updatedAt": "2026-10-23T06:00:00.000Z", "key": "PLN-12", "assigneeIds": [], "labelIds": [], "assignedComments": {"total": 2, "resolved": 1, "assignedToMe": true}}}
```

```json bad=api.v1.task
{"data": {"id": "0192b3c4-5d6e-7f80-9a1b-2c3d4e5f6a7d", "title": "без полей"}}
```

### Wave chatai (PLNRAPP-210): settings, filters, batches, packs
- Filters of `GET /api/v1/tasks` and `search_tasks` (PLNRAPP-268), added to the existing ones: `labelId`, `priority`, `dueBefore`, `dueAfter` (dates), `unassigned` (bool), `archived` (bool).
- `POST /api/v1/tasks/batch` and MCP `batch_update_tasks` (needs `write`): `{taskIds | filter, patch, dryRun?}`; `patch` — `{statusId, labelIds: {add, remove}, assigneeIds: {add, remove}, fields, archived}`. At most 100 tasks (`filter` matching more → `400`), an empty `filter` or `patch` → `400`. `dryRun: true` changes nothing and returns the tasks the batch would touch. The result is `{matched, changed, errors: [{task, code}]}`; a failure of one task is listed in `errors`, the others are applied; `archived: false` (restore) needs a project admin. In the AI chat a batch without `dryRun` waits for one «yes».
- `POST /api/v1/tasks/move` and MCP `move_tasks` (needs `write`): `{taskIds, statusId, before? | index?}` — up to 100 tasks of the status project go to `statusId` in a row, in the order of `taskIds`: before the task `before` of that status (if it is one of the moved tasks — before the next one that stays), or at `index` among the other tasks of the status, or at the end. All or none: every task is checked first, then one transaction. The result is the moved tasks in that order. A refusal is `409 conflict` with `details.tasks: [{task, code, message}]` listing every problem task; `code` — `not_found`, `duplicate`, `forbidden` (below member in the project), `other_project` (the status is of another project), `archived`. A status that is not visible → `404`; both `before` and `index` → `400`. In the AI chat it waits for one «yes».
- Project settings (PLNRAPP-266), user permissions of the token owner, `write` token; `:id` of a project in the path, the body is the input of the same-named mutator without ids:

| method and path | MCP tool |
|---|---|
| `PATCH /api/v1/projects/:id` | `update_project` |
| `PUT /api/v1/projects/:id/modules/:moduleId` | `set_project_module` (dependent modules together) |
| `POST /api/v1/projects/:id/statuses`, `PATCH\|DELETE /api/v1/statuses/:id` | `create_status`, `update_status`, `delete_status` (`replaceWith` — the status the tasks move to) |
| `POST /api/v1/projects/:id/labels`, `PATCH\|DELETE /api/v1/labels/:id` | `create_label`, `update_label`, `delete_label` |
| `POST /api/v1/projects/:id/fields`, `PATCH\|DELETE /api/v1/fields/:id` | `create_field`, `update_field`, `delete_field` |
| `GET\|POST /api/v1/projects/:id/automations`, `PATCH\|DELETE /api/v1/automations/:id` | `list_automations`, `create_automation`, `update_automation`, `delete_automation` (module `automations` is on) |
| `GET\|POST /api/v1/projects/:id/ai-actions`, `PATCH\|DELETE /api/v1/ai-actions/:id` | `list_ai_actions`, `create_ai_action`, `update_ai_action`, `delete_ai_action` |

  Defaults of the server: the color of a status or label — `#6b7280`, `rank` of a status or field — after the last one. All paths are in `openapi.json`.
- Harness packs and event bindings by a `write` token of a project admin (PLNRAPP-269): `GET /api/ai/packs`, `POST /api/ai/packs/{upload,merge,activate,events}`, `GET /api/ai/packs/export`, `POST /api/ai/harness/{diff,apply}`; a `read` token or a non-admin → `403`. MCP: `ai_list_packs`, `ai_upload_pack` (`dryRun` — only conflicts with manually edited pages), `ai_diff_pack`, `ai_apply_pack`, `ai_set_pack_events`. Secret AI settings (connections, limits) stay session-only: a token gets `403`.
- Docs for the AI chat: MCP `search_docs_site {query, lang?: ru|en, section?}` — search over the h1–h3 sections of `docs-site/ru|en` (≤ 10 matches, snippet ≤ 300 characters); `section` (id `file#heading` from the result) returns the text of that section.

## MCP `/mcp` (CR-11)
- Streamable HTTP (`@modelcontextprotocol/sdk`), no MCP sessions on the server (stateless: each POST has its own transport). Entry — a Bearer token only; without it → `401`.
- Tools (inputs — zod, output — `content: [{type:'text', text: JSON}]`, compact JSON of the same shapes as REST v1, without whole `description` documents: `description` → text):
  - read: `list_spaces {}`, `list_projects {spaceId?}`, `search_tasks {query?, projectId?, statusId?, statusCategory?, assigneeId?, limit?≤200}` (search by `title` and `key`, case-insensitive), `get_task {task}` (id or key, with comments and `links`), `my_tasks {includeDone?: bool, statusCategory?}` (assigned to me; by default without done/cancelled), `list_fields {projectId}` (the project's field definitions, like REST `GET /api/v1/projects/:id/fields`), `project_dictionary {projectId}` (statuses `{id, name, category}`, labels `{id, name}`, members `{id, name, login}`); tasks in MCP responses also carry `status: {name, category} | null`;
  - write (needs `write`): `create_task` (as `POST /api/v1/tasks`), `update_task {task, …, fields?}` (as `PATCH`, including `fields`), `add_comment {task, text, parentId?, assigneeId?}`, `update_comment {id, text?, assigneeId?, resolved?}` (as `PATCH /api/v1/comments/:id`).
- Parity (PLNRAPP-186): every REST v1 operation has an MCP tool; the map is the `PARITY` table in `apps/api/test/mcp/mcp.test.ts`, the test fails on an operation without a tool.
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
