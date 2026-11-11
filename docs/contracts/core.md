---
type: contract
status: closed
module: core
updated: 2026-11-02
summary: Core contracts — C-schema, C-sync, C-mutators, C-modules, C-http; versions are in the headings, examples are checked by the contract test
related: ["docs/plan/core.md", "docs/roadmap.md", "docs/contracts/core-schema.md"]
contracts: [{"id": "C-schema", "version": 17}, {"id": "C-sync", "version": 2}, {"id": "C-mutators", "version": 14}, {"id": "C-modules", "version": 12}, {"id": "C-http", "version": 12}]
---

# Contracts of the core module

The owner of all contracts in this file is the core coordinator. Only the coordinator changes them: version +1 in the heading and in `CONTRACT_VERSIONS`, consumers are notified with `task note`. After WB-2 is issued, C-sync and C-mutators change only through the gateway.

**Contract test** — `packages/shared/test/contract.test.ts` (edited only by the coordinator). It checks this file against the code:
- versions from the `## C-… vN` headings = `CONTRACT_VERSIONS`;
- every ` ```json example=<name> ` block passes `contractSchemas[<name>]`, every ` ```json bad=<name> ` block does not; every schema has an example;
- entities of the "Entities" section (in `docs/contracts/core-schema.md`): names, fields, nullability, the line `scope · write · bootstrap · indexes` = `entitySchemas` and `ENTITIES`.

The DB schema against this file — `apps/api/test/contract.schema.test.ts` (appears before CR-2).

Contract code — `packages/shared/src/contract/` (exported from `packages/shared/src/index.ts`, no Node API): `CONTRACT_VERSIONS`, `contractSchemas`, `entitySchemas`, `ENTITIES`, types `Tx`, `MutatorCtx`, `MutatorDef`, functions `defineMutator`, `createRegistry`, class `MutatorError`, `uuidv7()`.

## C-schema v28

v28 (PLNRAPP-167): `users.bot` (bool, default `false`) — the AI bot: an active user `ai` created when the module `ai` is first enabled in a space; no sign-in (rejected by the flag), the token works — core-schema.md.

v27 (PLNRAPP-161): `notifications.kind` += `due_today`, `start_today` — at 9:xx in the assignee's profile zone (`users.timezone`, empty — UTC), for open, not archived tasks whose due date / start date is today there; the actor is the system user, one per task and kind per day.

v26 (PLNRAPP-154, -155): `tasks.archivedAt`, `tasks.archivedBy` (nullable, default null; an archived task is seen only in the project's Archive and deleted after 30 days) — core-schema.md.

v25 (PLNRAPP-143): `checklistItems.indent` (nested items: a level in the flat ranked list) — core-schema.md.

v24 (PLNRAPP-142): `checklistItems.linkedTaskId` (the item was turned into a task or subtask; the text links to it) — core-schema.md.

v23 (PLNRAPP-140): `notifications.kind` += `checklist_assigned` (to the assignee of a checklist item, new or changed; `body` — the item text).

v22 (PLNRAPP-140): `checklistItems.assigneeId` (an item assigned to a space member; such an open item makes the task «mine») — core-schema.md.

v21 (PLNRAPP-124): the personal entity `favorites` (favourites synced between devices instead of localStorage) — core-schema.md.

v20 (PLANARAPP-61): `notifications.kind` += `trial_ending` (cloud instance: to owners and admins when ≤ 30 days of the trial are left, `url` — `/settings/cloud`; docs/contracts/cloud-link.md).

v19 (PLANARAPP-10): the personal entity `dayPlans` («My day»: a task planned by the user for a date) — core-schema.md.

v18 (PLANARAPP-3, -4): `spaces.leadId` (the space lead) and `projects.defaultAssigneeId` (the assignee of a new task created without assignees), both nullable — core-schema.md.

v17 (projects, PJ-11): `projects.membersMode` (`inherit|custom`, default `inherit`) and the entity `projectMembers` — core-schema.md, docs/contracts/projects.md §PJ-11.

v16 (projects, PJ-3): `projects.modules` (text[], required, default `[]`: ids of data modules enabled for the project) — core-schema.md, docs/contracts/projects.md §PJ-3.

v15 (projects, PJ-1): `statuses.projectId`, `labels.projectId` (uuid, required, immutable; statuses and labels belong to a project, `spaceId` stays denormalized) — core-schema.md, docs/contracts/projects.md.

v14: `savedViews.node` (text?, a node's saved view of a built-in tab: `w`, `s:<spaceId>`, `p:<projectId>`, with the suffix `:me-<mode>` for "My work"; null — a named view; replica rows before v14 have no such field) — core-schema.md.

v13: `savedViews.icon` (text?, icon of the saved view tab; replica rows before v13 have no such field) — core-schema.md.

v12: `notifications.kind` += `doc_mention` (a mention on a docs module page, `url` — `/m/docs/<pageId>`).

v11 (comments): `comments.parentId` (threads), `assigneeId`, `resolvedAt`, `resolvedBy`; `notifications.kind` += `comment_assigned` (for the assignee of an assigned comment).

v10 (Inbox as in ClickUp): `notifications.changes` — what changed (`status_changed`: `{statusId: [old, new]}`).

v9 (p3, PT-1): non-synced table `ydocs` — the Y.Doc state of collaborative editing (`docs/contracts/p3.md` §P3-ydoc).

v8 (CL-1a): `notifications` for chat; scope `space|members`.

v7 (WK-0): `tasks.cycleId` (work.md).
v6 (FT): `fieldDefs`, `taskLinks`, format of `tasks.fields` (features.md).

### General rules
- DB — snake_case, TS and the wire — camelCase (Drizzle `casing: 'snake_case'`). The field name on the wire = the Drizzle property name; the column = snake_case of it (`spaceId` → `space_id`).
- Entity name = table name in camelCase: `taskAssignees` ↔ `task_assignees`. It is also the key in `bootstrap.data`, `changes.entity`, the `Tx` argument.
- `id` — `uuid` (uuidv7, created by the client; server rows — Postgres 18 `uuidv7()`), except `settings.id` (`text`, the setting key). PK — `id`.
- A row on the wire contains **all** fields of the entity; a missing value is `null` (the key is not omitted).
- `createdAt`/`updatedAt` are set by the mutator from `ctx.now`; on the server `ctx.now` is the server time.
- `spaceId` is immutable after creation (a patch with a different `spaceId` → `invalid_args`); for tasks, comments, attachments, checklists, task labels it is denormalized. The exception — a task moved to another space (PLNRAPP-152, `task.update` with `projectId`): the write is authorized in both spaces; the server writes `del` to the old space's journal before the `put`, then moves every space-scoped row with that `taskId` (core and modules, incl. `activity`) and reactions to its comments the same way, without rights checks and hooks; a subtask left in the old space (hidden from the caller) gets `parentId = null`.
- Enum — `text` + `CHECK`. `rank` — `text COLLATE "C"` (fractional-indexing keys are compared bytewise).
- FK between synced tables — no cascade (`NO ACTION`): the mutator deletes child rows itself, through `Tx`, otherwise the client does not learn about the deletion. Exceptions — `activity.taskId`, `notifications.taskId/commentId` (no FK, the history outlives the task). Non-synced tables reference `users` with `ON DELETE CASCADE`.

### Types
| type | zod | Postgres |
|---|---|---|
| `uuid` | `z.uuid()` | `uuid` |
| `text` | `z.string()` | `text` |
| `int` | `z.number().int()` | `integer` (`size` — `bigint`, mode number) |
| `bool` | `z.boolean()` | `boolean` |
| `ts` | `z.iso.datetime()` (UTC, `Z`, ms) | `timestamptz` |
| `date` | `z.iso.date()` (`YYYY-MM-DD`) | `date` |
| `rank` | `z.string().min(1)` | `text COLLATE "C"` |
| `obj` | `z.record(z.string(), z.unknown())` | `jsonb` (object) |
| `json` | `z.json()` | `jsonb` (any JSON) |
| `doc` | TipTap JSON: `z.looseObject({type: z.literal('doc'), content: z.array(z.unknown()).optional()})` | `jsonb` |
| `enum(a,b)` | `z.enum([...])` | `text` + `CHECK` |
| `uuid[]` | `z.array(z.uuid())` | `uuid[]` |

The suffix `?` means `.nullable()` (the key is present, the value may be `null`).

### Visibility and permissions (the line under an entity heading)
- `scope` — who sees the row (bootstrap, pull): `space` — members of the space `spaceId` (for `spaces` — `id`); `user` — only `userId`; `global` — all signed-in users; `space|user` — `user` if `userId` is not null, otherwise `space`. `space|members` (C-sync v2) — `space` if `spaceId` is set, otherwise the members of the container per `meta.members` (`docs/contracts/collab.md` §X-core item 1).
- `write` — the minimum role to write through the server `Tx`: `guest` < `member` < `admin` — the role in `spaceMembers` of this space; `self` — `row.userId = ctx.userId`; `instance_admin` — `users.role` ∈ {owner, admin}; `server` — server code only, forbidden for mutators; `member|self` — by the row's `scope`.
- Creating a space (`put` of a new row into `spaces`) is allowed to anyone with `users.role` ≠ guest; in the same transaction they may create a `spaceMembers` row for themselves with the admin role.
- `bootstrap` — whether the entity is included in `GET /sync/bootstrap` (`no` — only via pull and its own REST).
- `indexes` — fields allowed for `Tx.scan({index, eq})` (in Dexie these are indexes; in the DB — b-tree).

### Entities

Entities — docs/contracts/core-schema.md (part of C-schema v22).

### Non-synced tables (server only)
| table | columns |
|---|---|
| `sessions` | `id text pk` (sha256 hex of the cookie token), `user_id uuid`, `created_at`, `expires_at`, `last_seen_at timestamptz`, `user_agent text?` |
| `files` | `sha256 text pk`, `size bigint`, `mime text`, `width int?`, `height int?`, `created_by uuid`, `created_at` |
| `push_subscriptions` | `id uuid pk`, `user_id uuid`, `endpoint text unique`, `p256dh text`, `auth text`, `user_agent text?`, `created_at` |
| `client_mutations` | `client_id uuid pk`, `user_id uuid`, `last_mutation_id bigint not null`, `updated_at` |
| `changes` | `seq bigserial pk`, `space_id uuid?`, `user_id uuid?`, `project_id uuid?`, `entity text`, `id text`, `op text check (put,del)`, `data jsonb?`, `created_at`; indexes `(space_id, seq)`, `(user_id, seq)` |
| `file_uploads` | `sha256 text`, `user_id uuid`, `created_at`; primary key (sha256, user_id) — who uploaded the file (duplicate content is a single row in files) |
| `login_attempts` | `key text pk` (ip and login joined by "\|"), `attempts int`, `window_started_at timestamptz` — a 1-minute window for the login limit |
| `api_tokens` | `id uuid pk`, `user_id uuid`, `name text`, `token_sha256 text unique`, `prefix text`, `scope text check (read,write)`, `expires_at?`, `last_used_at?`, `revoked_at?`, `created_at` |
| `ydocs` | `doc_id text pk` (document name docs:uuid or task:uuid), `state bytea not null` (Y.encodeStateAsUpdate), `updated_at timestamptz` — p3.md §P3-ydoc |

Migrations — drizzle-kit, directory `apps/api/drizzle/`, schema — `apps/api/src/db/schema.ts` (+ module schemas `modules/*/api/schema.ts`, tables prefixed with `<moduleId>_`).

## C-sync v2

v2 (CL-1a): `space|members`, WS `typing` — `docs/contracts/collab.md` §X-core items 1–2.

Transport — JSON over HTTP, authorization — session (C-http) or Bearer. Request-level errors use the C-http format (`401 unauthenticated`, `400 invalid_request`, `413 payload_too_large`, `500 internal`).

### The `changes` journal
- Every write of the server `Tx` adds a row: `put` — with the full row in `data` (wire format, camelCase), `del` — `data = null`. `patch` also yields a `put` with the full row.
- Visibility columns by `scope`: `space` → `space_id = row.spaceId` (for `spaces` — `row.id`), `user_id = null`; `user` → `space_id = null`, `user_id = row.userId`; `global` → both null.
- **Ordering.** A transaction that writes to `changes` takes `pg_advisory_xact_lock(7311)` with its first write; this way the order of `seq` matches the commit order and pull does not skip rows. v2: the server `Tx` of a mutation takes it before the first `get`/`scan` (mutations are serialized: read-then-write — `docs.lock`, the chat `lastSeq` — are race-free).
- In the same transaction — `SELECT pg_notify('planar_changes', '<max seq>')`: the number only.
- **Project rows (PJ-11).** `changes.project_id` — the project a row belongs to (its `projectId`, the project of its task, `projects.id` for the project itself; null — none). Pull skips rows whose project is hidden from the user (`projects.membersMode = 'custom'` and no `projectMembers` row; space admins and instance admins excepted). A change of `projectMembers` or of `membersMode` → `_reset` (as below) for every affected user.
- **Reset.** Adding or removing a space member → a row `entity = '_reset'`, `op = 'put'`, `id = <userId>`, `user_id = <userId>`. A change of `settings.enabled_modules` → `_reset` with both columns null (for everyone).

### `GET /sync/bootstrap?clientId=<uuid>`
One `REPEATABLE READ` snapshot. `cursor` = `max(seq)` of the journal (0 — empty). `lastMutationId` — from `client_mutations` for `clientId` (0 — no record). `data` — all entities with `bootstrap: yes` visible to the user, of enabled modules; the key is present for every such entity, even an empty one.

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
One `REPEATABLE READ` snapshot. `changes` — rows visible to the user with `seq > cursor`, in ascending `seq`, of enabled modules only. The response `cursor` = `max(seq)` of the journal (not only of the visible rows). `reset: true` (and `changes: []`) if: among the visible rows there is a `_reset`; `cursor` is greater than `max(seq)` or less than the minimum stored `seq - 1`; there are more than 5000 visible rows. On `reset` the client does a bootstrap again.

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
Body ≤ 1 MB, mutations ≤ 100. `mutations[].id` — an integer > 0, growing on the client (`clientId` — uuidv7, created together with the local database).
- Mutations run in order, each in its own transaction: check `args` against the mutator's zod → `run(serverTx, args, ctx)` → `client_mutations.last_mutation_id = id` → commit.
- `id ≤ last_mutation_id` — already processed: not executed, the result is `{id, ok: true}`.
- A rejected mutation (`MutatorError`, zod error, unknown name, any exception inside `run`): the transaction is rolled back, then in a separate transaction `last_mutation_id = id`; the result is `{id, ok: false, code, message}`. The client removes it from the queue.
- An infrastructure failure (DB unavailable, commit error) — the whole response is `500`; already committed mutations are idempotent on retry.
- `clientId` belongs to the first user who sent it; another user's → `403 forbidden`.
- Result codes: `invalid_args`, `forbidden`, `not_found`, `conflict`, `unknown_mutator`, `internal`.

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
Authorization — the session cookie at upgrade (plus an Origin check, C-http); without a session — close with code 4401. The server listens to `LISTEN planar_changes` on one connection and sends `{t:'poke', seq}` to all connected clients (batches may be merged for up to 50 ms; seq is the last one). After connecting, the client sends `{t:'hello', cursor}`; if `max(seq) > cursor`, the server replies with `poke` immediately. On `poke` with `seq > cursor` the client does a pull. Ping — WS ping/pong every 30 s. No data is transferred over WS.

```json example=ws.server
{"t": "poke", "seq": 1050}
```

```json example=ws.client
{"t": "hello", "cursor": 1042}
```

```json bad=ws.server
{"t": "poke"}
```

### Client (for web)
Applies `changes` by `seq`; `reset` → bootstrap. After a pull it drops from the queue the mutations with `id ≤ lastMutationId` and re-applies the rest on top of the server state (rebase). Push is retried on a network error and `5xx` with a growing pause of 1–30 s; `401` — redirect to sign-in.

## C-mutators v21

v21 (PLNRAPP-154, -155): `task.archive`, `task.restore`; `task.delete`, `task.restore` — admin of the project / space / instance only — core-mutators.md.

v20 (PLNRAPP-143): `checklist.add`, `checklist.update` += `indent?` (0–4) — core-mutators.md.

v19 (PLNRAPP-142): `checklist.update` += `linkedTaskId?` — core-mutators.md.

v18 (PLNRAPP-140): `checklist.update` += `assigneeId?` — core-mutators.md.

v17 (PLNRAPP-124): `favorite.add`, `favorite.move`, `favorite.remove` — core-mutators.md.

v16 (PLANARAPP-10): `day.plan`, `day.move`, `day.remove` — core-mutators.md.

v15 (PLANARAPP-3, -4): `space.update` += `leadId?`; `project.create` / `project.update` += `defaultAssigneeId?`; `task.create` without assignees assigns the project's `defaultAssigneeId` — core-mutators.md.

v14 (projects, PJ-11): `project.setMembersMode`, `projectMember.add|setRole|remove`; `member.remove` also deletes the user's `projectMembers` — core-mutators.md, docs/contracts/projects.md §PJ-11.

v13 (projects): `project.create` += optional `modules` (PJ-14) — docs/contracts/projects.md.

v12 (projects): `project.setModule` (PJ-3); `view.setNodeDefault` and the rules of node views (PJ-4) — docs/contracts/projects.md.

v11 (projects, PJ-1): `status.*`, `label.*`, `project.create`, `space.create`, `task.create/update` work by project; new `project.copyDictionaries` — docs/contracts/projects.md.

v10: `view.create` += `node?` (a node's saved view, always personal) — core-mutators.md.

v9: `view.create`, `view.update` += `icon?` — core-mutators.md.

v8: `space.delete` += `withContent?` (a space with projects and tasks — bulk deletion in settings); the root space is not deleted — core-mutators.md.

v7 (comments): `comment.create` += `parentId?`, `assigneeId?`; `comment.assign`, `comment.resolve`; `comment.delete` of a root — with its thread — core-mutators.md.

v6 (groups): `project.create` in the root space (`settings.root_space`, the "Workspace" level; created and filled with members by `apps/api/src/spaces/root.ts`) → `invalid_args` — core-mutators.md.

v5 (p4, PF-4): `settings.set {id: 'enabled_modules'}` — a new module id with `unavailable` ≠ null → `invalid_args` (server only) — p4.md, core-mutators.md.

v4 (design): `space.create` += `statusNames?` (core-mutators.md).
v3 (FT): `field.*`, `task.setField`, `link.*` (core-mutators.md).

Code — `packages/shared/src/contract/mutator.ts` (types and registration), domain — `packages/shared/src/mutators/` (CR-5). No Node API: the same code goes to the browser.

```ts
export type EntityName = keyof typeof entitySchemas;
export type Row<E extends EntityName> = z.output<(typeof entitySchemas)[E]>;

export interface MutatorCtx { userId: string; now: string /* ISO ts */; server: boolean }

export interface Tx {
  get<E extends EntityName>(entity: E, id: string): Promise<Row<E> | undefined>;
  put<E extends EntityName>(entity: E, row: Row<E>): Promise<void>;          // insert or full replace
  patch<E extends EntityName>(entity: E, id: string, partial: Partial<Row<E>>): Promise<void>; // no row → MutatorError('not_found')
  del<E extends EntityName>(entity: E, id: string): Promise<void>;           // no row → nothing
  scan<E extends EntityName>(entity: E, opts?: { index: string; eq: unknown }): Promise<Row<E>[]>; // order not guaranteed
}

export interface MutatorDef<A extends z.ZodType = z.ZodType> {
  name: string; args: A; run(tx: Tx, args: z.output<A>, ctx: MutatorCtx): Promise<void>;
}
export function defineMutator<A extends z.ZodType>(def: MutatorDef<A>): MutatorDef<A>; // returns def as is
export function createRegistry(defs: MutatorDef[]): Map<string, MutatorDef>;          // duplicate name → throw

export type MutationErrorCode = 'invalid_args' | 'forbidden' | 'not_found' | 'conflict';
export class MutatorError extends Error { constructor(public code: MutationErrorCode, message: string) }
export function uuidv7(): string; // RFC 9562, crypto.getRandomValues
```

### Rules
- `scan` with an `index` not in the entity's `indexes` → `throw Error` (in all `Tx` implementations). Without `opts` — all rows (only for small entities: `users`, `settings`, `spaces`, `statuses`, `labels`).
- `put`/`patch` validate the resulting row against `entitySchemas[entity]`; a violation → `MutatorError('invalid_args')`.
- A mutator is deterministic: all ids of created rows and `rank` come in `args` (computed by the caller: `uuidv7()`, `generateKeyBetween` from `fractional-indexing`). Time — only `ctx.now`. Branching on `ctx.server` — only to avoid doing on the client what only the server can do.
- Update mutators: a missing field is unchanged, `null` clears it. Changes are per field: on conflict the last write on the server wins.
- Deleting a parent — the mutator first deletes the child rows (see FK in C-schema).
- **Server `Tx`** (CR-4, `apps/api/src/sync/server-tx.ts`): on top of a Drizzle transaction, rows in wire format. Every write is checked against the entity's `write` permission (for `patch`/`del` and replacement — against the existing row, for `put` — against the new one as well); a denial → `MutatorError('forbidden')`. Then a row in `changes`, and for `tasks`/`taskAssignees`/`taskLabels`/`comments` — `activity` (C-schema). A uniqueness violation (23505) → `conflict`, FK (23503) → `invalid_args`. Reads (`get`/`scan`) do not check permissions: mutators are trusted code. Server code (CR-3, CR-7) writes through the same `Tx` with the system `ctx.userId` and a permission bypass (`asSystem`), to get into `changes`.
- **`MemoryTx`** (CR-5, `packages/shared/src/testing/memory-tx.ts`, exported as `@planar/shared/testing`) — `new MemoryTx()`, the same semantics without permissions, `changes`, `activity`; `get`/`scan` return copies. Needed by web for tests and as a model for Dexie.
- The `Tx` semantics test suite — `txContractSuite(name, setup)` from `packages/shared/test/tx-contract.ts`: both implementations must pass it (MemoryTx — `packages/shared/test/memory-tx.test.ts`, CR-5; the server one — CR-4).

### Domain mutators v2
The table of names, args and rules — `docs/contracts/core-mutators.md` (part of C-mutators, the version is that of this section).

## C-modules v13

v13 (PLNRAPP-167): `ModuleHookApi.ensureBotUser(login, name): Promise<string>` — an active user with `users.bot = true` and no password, idempotent (a login taken by a person → error); `packages/server-kit` += `secretKey/encrypt/decrypt` (AES-256-GCM, key `PLANAR_SECRET_KEY`) — one copy for the modules gitlab, email, ai.

v12 (groups): `FrontendModuleManifest.groupTabs?` — `GroupTabDef {id, tab: inbox|docs|chats|reports|settings, label?, icon?, order?, component}`; the component receives `scope: GroupScope {level: workspace|space|project, spaceId, projectId, rootSpaceId}` (for the Workspace `spaceId` is the root space) and shows data of the group level and of nested ones; several contributions to one tab become subtabs (`?r=<moduleId>:<id>`). SDK += `useGroupLevels(scope)` — group levels from top to bottom (`apps/web/src/layout/groups.ts`). `SettingsPageDef.level?` (workspace by default | space | project) — the group settings level; the page receives `spaceId` and `projectId`. The `nav` sections of the modules docs, chat, time, import, dashboards, workload, goals are removed — their place is in the group tree; the `nav` point is for other modules. SDK += `groupUrl`, `GroupProjectPick`.
v11 (p4): `BackendModuleManifest.unavailable?`, `GET /api/modules` += `unavailable`; `/api/<id>/setup/*` of a disabled module — owner/admin only (ModuleGuard); `FrontendModuleManifest.setup?`; `CommandDef.newTaskMenu?` — docs/contracts/p4.md (introduction).
v10 (design, DS-0): SDK += C-ui v3 components — work-api.md, design.md.
v9 (p3, PT-5): `CoreServices` += `execute(userId, muts, opts?)` — like `JobApi.execute`; `ensureSystemUser(login, name): Promise<string>` — a deactivated user without a password (like "Automation"), a repeated call returns the same one; `storeFile(buf: Buffer, uploaderId: string): Promise<{sha256, size, mime, width, height}>` — the same record as `POST /files` (`files`, `file_uploads`, limit `MAX_UPLOAD_MB` → `413`).
v8: JobApi.execute opts.after — in the transaction after all mutations, an error rolls back (PL-2) — work.md §C-modules v4.
v7: the SDK list (sendTyping/onTyping with C-sync v2) — work-api.md.
v3–v6 (work, owner of C-modules): hooks, server-kit, SDK, settings, collab fixes — work.md, work-api.md.

A module is a directory `modules/<id>/` (`id` — `^[a-z][a-z0-9-]{1,30}$`):
- `shared/index.ts` — `export const shared: SharedModuleManifest = { id, mutators: MutatorDef[], entities: Record<string, {schema: ZodObject, meta: EntityMeta}> }` (no Node API; entities follow the C-schema rules, names are the module id prefix in camelCase);
- `api/index.ts` — `export const api: BackendModuleManifest = { id, nestModule, mutators, entities }` (`mutators`, `entities` — from `shared`); tables — `api/schema.ts`;
- `web/index.ts` — `export const web: FrontendModuleManifest = { id, routes?, views?, taskPanels?, commands?, fieldTypes?, settings? }`; element types are defined by web (C-ui).

`EntityMeta` = an entity line from C-schema: `{scope, write, bootstrap: boolean, indexes: string[]}`; built-in ones — `ENTITIES`.

HTTP routes of a module — only under `/api/<id>/` (the enable guard finds them by the prefix). The registry of api modules — `apps/api/src/modules/installed.ts` (a line per module); the module package — `@planar/module-<id>` in the workspace. Module entities in `Tx` — by casting the name to `EntityName` (the `Tx` types know only the core).

Enabling — `settings.enabled_modules`. A disabled module: its HTTP routes answer `404 module_disabled`, its mutators — `unknown_mutator`, its entities do not reach bootstrap and pull. All modules are loaded at API start (the routes are always there, the guard does the check); a change of `enabled_modules` writes `_reset` for everyone.

## C-http v12

v12 (ops): `GET /api/health/ready`, `GET /api/metrics` (docs/contracts/ops.md).

v11 (p3): WS `/collab` (Hocuspocus; cookie and Origin — as for `/ws`; `docs/contracts/p3.md` §P3-collab); env `PLANAR_SECRET_KEY`, `TRUST_PROXY`; the entry `/f/*` — a separate HTML page of public forms (§P3-forms).

v10 (CL-1a): `GET /files` and push without a task — collab.md §X-core items 3–4.

v9 (WK-0): `cycleId` in REST v1; WK-5 paths — work.md.
v8 (FT): fields in REST v1 and MCP (core-api-v1.md).

### Paths and environment
- `/api/*` — REST, `/sync/*` — sync, `/ws` — WebSocket, `/files/*` — files, `/mcp` — MCP (CR-11), `/collab` — collaborative editing WebSocket (v11), `/f/*` — public form page, a separate HTML entry of web without the app (v11). In dev Vite proxies them to api, in prod — Caddy.
- Env api: `DATABASE_URL`, `PORT` (3000), `PUBLIC_URL` (origin for the check, e.g. `http://localhost:5173`), `COOKIE_SECURE` (`true` in prod), `DATA_DIR` (`./data`, files — `$DATA_DIR/files/<ab>/<cd>/<sha256>`, ab and cd — the first 4 hex characters), `MAX_UPLOAD_MB` (50), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `LOG_LEVEL`, `PLANAR_SECRET_KEY` (v11; 32 bytes in base64 — the AES-256-GCM key for module secrets, e.g. the GitLab token; not set — features with secrets answer `503 unavailable`). `TRUST_PROXY` (v11) — IPs/CIDRs of trusted proxies, comma-separated (Fastify `trustProxy` as a list, not `true`); empty — off: `req.ip` is the connection address. Set — `req.ip` is taken from `X-Forwarded-For` only from addresses in the list. Prod `compose.yml`: a fixed subnet of the Caddy network, the api port is not published outside. The login limit and the public-form limit are counted by `req.ip`.
- JSON body ≤ 1 MB, except file uploads.

### Errors
Any non-2xx response is JSON `{code, message, details?}`. `details` of `invalid_request` — `issues` from zod.

| status | code |
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

### Session and Origin
- Cookie `planar_sid`: 32 random bytes, base64url; `HttpOnly; SameSite=Lax; Path=/`, `Secure` when `COOKIE_SECURE=true`. In the DB — only the sha256 hex (`sessions.id`). Lifetime 30 days, extended when < 15 remain.
- Unsafe methods (POST, PUT, PATCH, DELETE) with cookie authorization and the `/ws` upgrade: the `Origin` header must match the origin of `PUBLIC_URL`, otherwise `403 origin_mismatch` (a missing header is also a refusal).
- `Authorization: Bearer plnr_<…>` (CR-10) gives the same `ctx.userId`; Origin is not checked. A `read` token — only GET and `/sync/bootstrap`, `/sync/pull`; otherwise `403 forbidden`. Tokens, REST `/api/v1` and MCP `/mcp` — `docs/contracts/core-api-v1.md` (part of C-http).
- A deactivated user — `401 unauthenticated` (sessions are deleted).

### Core endpoints
| method and path | input → output | task |
|---|---|---|
| `GET /api/health` | → `200 {ok: true, db: 'up'}` \| `503 {ok: false, db: 'down'}` | CR-1 |
| `GET /api/setup` | → `200 {needed: boolean}` — `true` while there are no users; no authorization | CR-3 |
| `POST /api/setup` | `{login, name, password}` → `201 {user}`; users already exist → `409 conflict` | CR-3 |
| `POST /api/auth/login` | `{login, password}` → `200 {user}` + cookie; `401 invalid_credentials`; > 10 attempts/min per IP+login → `429` | CR-3 |
| `POST /api/auth/logout` | → `204`, cookie cleared | CR-3 |
| `POST /api/auth/impersonate` | `{userId}` → `200 {user}` + cookie of that user, the caller's session is deleted; only an owner/admin from a cookie session (token → `403`), only an active user of a strictly lower role (`403` / `404`) | PLNRAPP-129 |
| `GET /api/auth/me` | → `{user}` \| `401` | CR-3 |
| `GET /api/users` | → `{users: user[]}` (instance_admin) | CR-3 |
| `POST /api/users` | `{login, name, password, role, email?}` → `201 {user}` (instance_admin) | CR-3 |
| `PATCH /api/users/:id` | `{name?, email?, role?, password?, deactivated?: bool, avatarFile?: string\|null, timezone?: string}` → `{user}`; `avatarFile` — a sha256 from `POST /files` uploaded by this user (`file_uploads`), otherwise `400 invalid_request`; `timezone` — an IANA zone, otherwise `400`; for oneself — only name, email, password, avatarFile, timezone | CR-3 |
| `GET /api/push/vapid` | → `{publicKey}` (VAPID, base64url) | CR-7 |
| `POST /api/push/subscribe` | `{endpoint, keys: {p256dh, auth}}` → `201`; a repeat of the same endpoint — an update, `200` | CR-7 |
| `DELETE /api/push/subscribe` | `{endpoint}` → `204` (own only) | CR-7 |
| `GET /api/modules` | → `{modules: [{id, enabled}]}` — all loaded modules; enabling — the mutator `settings.set` `enabled_modules` | CR-8 |
| `GET /api/tasks/:id/activity` | → `{rows: activity[]}` by `createdAt`, permissions — task visibility | CR-4 |
| `POST /files` | multipart, a single field `file` → `201 {sha256, size, mime, width, height}`; > `MAX_UPLOAD_MB` → `413` | CR-6 |
| `GET /files/:sha256` | → stream; `?name=` for `Content-Disposition`; access: the file is attached in the user's space, or it is the user's avatar, or `file_uploads(sha256, userId)` exists; otherwise `404` | CR-6 |
| `GET /files/:sha256/preview?w=256\|1024` | → `image/webp`; not an image → `404` | CR-6 |

`user` in responses is a `users` row (C-schema), without `password_hash`. Password — from 8 characters, argon2id.

### Web Push
The push body format — `docs/contracts/core-api-v1.md` §Web Push (part of C-http).
