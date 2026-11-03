---
type: reference
status: closed
module: core
updated: 2026-11-02
summary: Entities of C-schema v17 — tables, fields, nullability, scope/write/bootstrap/indexes; checked by the contract test
related: ["docs/contracts/core.md"]
---

# Entities of C-schema v17

Part of the contract `C-schema v17` from `docs/contracts/core.md`. The section is read by the contract test (`packages/shared/test/contract-doc.ts` → `docEntities`); the version is in the heading `## C-schema vN` in core.md.

## Entities

#### users
scope: global · write: server · bootstrap: yes · indexes: login

| field | type | note |
|---|---|---|
| `id` | uuid | |
| `login` | text | unique, lowercase |
| `name` | text | |
| `email` | text? | |
| `role` | enum(owner,admin,member,guest) | instance role; owner is the first user |
| `avatarFile` | text? | sha256 of the file |
| `deactivatedAt` | ts? | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

DB only: `password_hash text` (argon2id). Never goes onto the wire.

#### spaces
scope: space · write: admin · bootstrap: yes · indexes: —

| field | type | note |
|---|---|---|
| `id` | uuid | also the spaceId for visibility |
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

| field | type | note |
|---|---|---|
| `id` | uuid | unique (spaceId, userId) |
| `spaceId` | uuid | |
| `userId` | uuid | |
| `role` | enum(admin,member,guest) | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### projects
scope: space · write: member · bootstrap: yes · indexes: spaceId

| field | type | note |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `name` | text | 1–100 |
| `key` | text | `^[A-Z][A-Z0-9]{1,9}$`, unique in the instance (violation → `conflict`) |
| `description` | doc? | |
| `color` | text? | |
| `icon` | text? | |
| `leadId` | uuid? | |
| `rank` | rank | |
| `archivedAt` | ts? | |
| `modules` | text[] | v16: ids of data modules enabled for the project; default `[]`; replica rows before v16 have no such field (treated as `[]`) |
| `membersMode` | enum(inherit,custom) | v17: `inherit` — roles from `spaceMembers`; `custom` — from `projectMembers`; default `inherit`; replica rows before v17 have no such field (treated as `inherit`) |
| `createdAt` | ts | |
| `updatedAt` | ts | |

DB only: `task_counter integer not null default 0`.

#### projectMembers
scope: space · write: server · bootstrap: yes · indexes: projectId, userId

| field | type | note |
|---|---|---|
| `id` | uuid | unique (projectId, userId) |
| `spaceId` | uuid | denormalized, immutable |
| `projectId` | uuid | |
| `userId` | uuid | a member of the space |
| `role` | enum(admin,member,guest) | a space guest — only `guest` |
| `createdAt` | ts | |
| `updatedAt` | ts | |

v17: rows exist only while `projects.membersMode = 'custom'`; written by the mutators `project.setMembersMode`, `projectMember.*` (rights — admin of the space / instance admin, checked by the server tx); visible only to the effective members of the project and to space admins (docs/contracts/projects.md §PJ-11).

#### statuses
scope: space · write: admin · bootstrap: yes · indexes: spaceId, projectId

| field | type | note |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | denormalized from the project, immutable |
| `projectId` | uuid | the owning project (v15), immutable |
| `name` | text | |
| `category` | enum(backlog,todo,in_progress,done,cancelled) | |
| `color` | text | |
| `rank` | rank | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### tasks
scope: space · write: member · bootstrap: yes · indexes: spaceId, projectId, parentId, statusId, cycleId

| field | type | note |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | = `projects.spaceId` |
| `projectId` | uuid | only a project of the same space |
| `number` | int? | null on the client until the server responds; task key = `${project.key}-${number}`; unique (projectId, number) |
| `parentId` | uuid? | subtask |
| `statusId` | uuid | a status of the same space |
| `title` | text | 1–500 |
| `description` | doc? | |
| `priority` | int | 0 none, 1 urgent, 2 high, 3 medium, 4 low |
| `rank` | rank | manual order |
| `dueDate` | date? | |
| `startDate` | date? | |
| `createdBy` | uuid | |
| `completedAt` | ts? | set by the mutator on a move to the done/cancelled category, cleared on leaving it |
| `fields` | obj | `{<fieldDefs.id>: value}` — fields of the task's project, no `null`; format — features.md §F-fields; default `{}` |
| `cycleId` | uuid? | a sprints cycle, no FK (work.md) |
| `createdAt` | ts | |
| `updatedAt` | ts | |

Server: a `tasks` write with `number = null` gets `number = ++projects.task_counter` (in the same transaction). On a `projectId` change the mutator sets `number = null`.

#### taskAssignees
scope: space · write: member · bootstrap: yes · indexes: taskId, userId

| field | type | note |
|---|---|---|
| `id` | uuid | unique (taskId, userId) |
| `spaceId` | uuid | |
| `taskId` | uuid | |
| `userId` | uuid | |
| `createdAt` | ts | |

#### taskWatchers
scope: space · write: guest · bootstrap: yes · indexes: taskId, userId

| field | type | note |
|---|---|---|
| `id` | uuid | unique (taskId, userId); mutators add and remove only the caller |
| `spaceId` | uuid | |
| `taskId` | uuid | |
| `userId` | uuid | |
| `createdAt` | ts | |

#### labels
scope: space · write: member · bootstrap: yes · indexes: spaceId, projectId

| field | type | note |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | denormalized from the project, immutable |
| `projectId` | uuid | the owning project (v15), immutable |
| `name` | text | |
| `color` | text | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### taskLabels
scope: space · write: member · bootstrap: yes · indexes: taskId, labelId

| field | type | note |
|---|---|---|
| `id` | uuid | unique (taskId, labelId) |
| `spaceId` | uuid | |
| `taskId` | uuid | |
| `labelId` | uuid | |
| `createdAt` | ts | |

#### fieldDefs
scope: space · write: member · bootstrap: yes · indexes: spaceId, projectId

| field | type | note |
|---|---|---|
| `id` | uuid | value key in `tasks.fields` |
| `spaceId` | uuid | = `projects.spaceId` |
| `projectId` | uuid | the field belongs to the project |
| `name` | text | 1–100 |
| `type` | enum(text,number,date,select,user,url,money) | immutable after creation |
| `options` | obj | by type (features.md §F-fields) |
| `rank` | rank | order of fields in the card and of default columns |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### taskLinks
scope: space · write: member · bootstrap: yes · indexes: taskId, targetId

| field | type | note |
|---|---|---|
| `id` | uuid | one row per pair: a unique index on least/greatest of taskId, targetId → `conflict` |
| `spaceId` | uuid | both tasks are in this space |
| `taskId` | uuid | `blocks`: taskId blocks targetId; `duplicates`: taskId is the duplicate |
| `targetId` | uuid | ≠ `taskId` |
| `kind` | enum(blocks,relates,duplicates) | the reverse side — features.md §F-links |
| `createdBy` | uuid | = ctx.userId |
| `createdAt` | ts | |

#### checklistItems
scope: space · write: member · bootstrap: yes · indexes: taskId

| field | type | note |
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

| field | type | note |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `taskId` | uuid | |
| `authorId` | uuid | = ctx.userId; edited and deleted only by the author |
| `parentId` | uuid? | thread: the root (a comment of this task without parentId); null — the root itself |
| `body` | doc | a mention is the node `{type:'mention', attrs:{id:<userId>}}` |
| `mentions` | uuid[] | ids from mention nodes, without repeats, in order of appearance |
| `assigneeId` | uuid? | assigned comment (root only) |
| `resolvedAt` | ts? | the assigned comment is marked resolved |
| `resolvedBy` | uuid? | who resolved it |
| `editedAt` | ts? | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### commentReactions
scope: space · write: guest · bootstrap: yes · indexes: commentId

| field | type | note |
|---|---|---|
| `id` | uuid | unique (commentId, userId, emoji) |
| `spaceId` | uuid | |
| `commentId` | uuid | |
| `userId` | uuid | = ctx.userId; the mutator adds and removes only its own |
| `emoji` | text | 1–32 characters (one emoji or a short code) |
| `createdAt` | ts | |

#### attachments
scope: space · write: member · bootstrap: yes · indexes: taskId, commentId

| field | type | note |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `taskId` | uuid | |
| `commentId` | uuid? | |
| `fileSha256` | text | hex, 64 characters; the file must be in `files` |
| `name` | text | name for download |
| `mime` | text | |
| `size` | int | bytes |
| `width` | int? | for images |
| `height` | int? | |
| `uploadedBy` | uuid | |
| `createdAt` | ts | |

Server: `put` is allowed only if a row `file_uploads(fileSha256, ctx.userId)` exists or the file is already attached in this space; otherwise `forbidden`.

#### activity
scope: space · write: server · bootstrap: no · indexes: taskId

| field | type | note |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `taskId` | uuid | no FK |
| `actorId` | uuid | |
| `viaTokenId` | uuid? | id of the API token if the record was made through a token (CR-10), otherwise null |
| `kind` | enum(created,updated,deleted,assignee_added,assignee_removed,label_added,label_removed,commented) | |
| `changes` | obj | `updated`: `{<field>: [old, new]}` without `updatedAt`, `rank`; `assignee_*`: `{userId}`; `label_*`: `{labelId}`; `commented`: `{commentId}`; otherwise `{}` |
| `createdAt` | ts | |

Written by the server `Tx` on writes of `tasks`, `taskAssignees`, `taskLabels`, `comments` (creation). History — `GET /api/tasks/:id/activity` (C-http).

#### notifications
scope: user · write: self · bootstrap: yes · indexes: taskId

| field | type | note |
|---|---|---|
| `id` | uuid | |
| `userId` | uuid | recipient |
| `spaceId` | uuid? | for grouping; does not affect visibility; null — a personal chat dialog |
| `kind` | enum(assigned,mentioned,commented,status_changed,chat_mention,chat_dm,chat_reply,comment_assigned,doc_mention) | `chat_*` is created by the chat module (collab.md §CH) |
| `taskId` | uuid? | no FK; null for `chat_*` |
| `url` | text? | in-app path for notifications without a task (the `url` rules from "Web Push") |
| `body` | text? | ≤ 140 characters, "Name: text"; for notifications without a task |
| `commentId` | uuid? | no FK |
| `changes` | obj? | `status_changed`: `{statusId: [old, new]}` (the `activity.changes` format); otherwise null (C-schema v10) |
| `actorId` | uuid | |
| `readAt` | ts? | |
| `createdAt` | ts | |

Created by the server (CR-7) through the server `Tx` on behalf of the system; with mutators a user only reads (`readAt`) and deletes their own. Bootstrap includes the last 200 by `createdAt`.

Triggers (a server hook in the mutation transaction, after `run`; the author of the action does not notify themselves; the recipient must be a space member):
- `assigned` — to a new assignee (`taskAssignees` put);
- `mentioned` — to each of `comments.mentions` (on creation and edit — only to the newly mentioned);
- `commented` — to task watchers on a new comment, except those mentioned in it;
- `status_changed` — to watchers when `tasks.statusId` changes.

Auto-subscription (the same hook, `taskWatchers` on behalf of the system): the task author, the assigned assignee, the comment author. Push — a pg-boss job per notification after commit.

#### savedViews
scope: space|user · write: member|self · bootstrap: yes · indexes: spaceId

| field | type | note |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `userId` | uuid? | not null — a personal view (seen only by the owner), null — shared across the space |
| `createdBy` | uuid | |
| `name` | text | |
| `icon` | text? | icon name from the web set (view tab); null — the default icon |
| `layout` | text | `list`, `board` or a module view id |
| `node` | text? | not null — a saved view of the built-in tab `layout` in a node: with `userId` — the owner's personal one, with `userId` null — the shared default of the node (at most one per node+layout, PJ-4); the node (`w`, `s:<spaceId>`, `p:<projectId>`, suffix `:me-<mode>` — "My work"); not shown among named views; null — a named view |
| `filter` | obj | |
| `config` | obj | grouping, sorting, columns |
| `rank` | rank | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### settings
scope: global · write: instance_admin · bootstrap: yes · indexes: —

| field | type | note |
|---|---|---|
| `id` | text | key |
| `value` | json | |
| `updatedAt` | ts | |

Keys of v1: `enabled_modules` — `string[]` of module ids. Secrets (VAPID etc.) are not put into `settings` — env only.
