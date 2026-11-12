---
type: reference
status: closed
module: collab
updated: 2026-11-02
summary: Collab contracts - documents (DC-*), chat (CH-schema, CH-mutators, CH-api, CH-web), core changes for chat (X-core)
related: ["docs/plan/collab.md", "docs/contracts/core.md", "docs/contracts/core-mutators.md", "docs/contracts/web.md"]
---

# Collab module contracts

Owner - the collab coordinator. The format of entities and mutators is as in `docs/contracts/core.md` (C-schema) and `core-mutators.md`; the C-schema rules "General rules", "Types", "Visibility and permissions" apply. Contract test - `apps/api/test/modules/collab.contract.test.ts`: it checks the `#### <entity>` sections and the mutator tables of this file against `shared.entities` and `shared.mutators` of the modules (field names, nullability, meta, arg names and optionality).

## DC-schema v3

v3 (PLNRAPP-154): `docsPages.archivedBy` - who archived.
v2 (groups): `docsPages.projectId` - the page level.

Module `docs` (`modules/docs`, package `@planar/module-docs`), tables `docs_<snake>`. FKs between module entities have no cascade; there is no FK to `tasks` (the core deletes tasks without knowing about the module): the UI does not show a link to a deleted task.

#### docsPages
scope: space · write: member · bootstrap: yes · indexes: spaceId, parentId

| field | type | note |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `projectId` | uuid? | a project of the same space; null - space level (for the root - Workspace); for descendants - same as the tree root |
| `parentId` | uuid? | a page of the same space; null - root |
| `rank` | rank | order among siblings (one `parentId`) |
| `title` | text | 0-200 characters; empty - the UI writes a localized "Untitled" placeholder |
| `icon` | text? | emoji, 1-16 characters |
| `body` | doc | ProseMirror/TipTap JSON; <= 512 KB as JSON |
| `text` | text | text of all text nodes of `body` joined by spaces, truncated to 100 000 characters; computed by the mutator |
| `files` | json | `string[]` - sha256 (hex 64) from the nodes `{type:'image', attrs:{src:'/files/<sha256>…'}}` of `body`, without repeats, in order; computed by the mutator |
| `createdBy` | uuid | |
| `updatedBy` | uuid | the last one who changed `title`/`icon`/`body` |
| `archivedAt` | ts? | |
| `archivedBy` | uuid? | who archived; default null |
| `createdAt` | ts | |
| `updatedAt` | ts | |

Invariants: `parentId` forms no cycle; a non-archived page has a non-archived parent.

#### docsTaskLinks
scope: space · write: member · bootstrap: yes · indexes: pageId, taskId

| field | type | note |
|---|---|---|
| `id` | uuid | unique (pageId, taskId) |
| `spaceId` | uuid | |
| `pageId` | uuid | |
| `taskId` | uuid | a task of the same space; no FK |
| `createdBy` | uuid | |
| `createdAt` | ts | |

#### docsLocks
scope: space · write: member · bootstrap: yes · indexes: —

| field | type | note |
|---|---|---|
| `id` | uuid | = page id (one lock per page) |
| `spaceId` | uuid | |
| `userId` | uuid | who is editing |
| `expiresAt` | ts | `ctx.now` + 120 s; the client renews it every 60 s while the editor is open |

A soft lock: only an "X is editing" indicator and read-only mode for the others in the UI; `docs.page.update` does not check it. An expired lock (`expiresAt ≤ ctx.now`) counts as absent. Shortcut: no collaborative editing; if needed - Yjs + Hocuspocus.

## DC-mutators v3

v4 (PLNRAPP-5): move between spaces — `spaceId` in `docs.page.move`.
v3 (PLNRAPP-154): `docs.page.archive` sets `archivedBy`; `docs.page.restore` - admin only; `docs.page.delete`.
v2 (groups): `projectId` in `docs.page.create`/`docs.page.move`.

Export - `shared.mutators` from `modules/docs/shared/index.ts`; `args` - `z.object`. All ids and `rank` are in args. Another space or a missing row - `not_found`/`forbidden` by the general rules of the server `Tx`.

| name | args | rules |
|---|---|---|
| `docs.page.create` | `id, spaceId, rank, projectId?, parentId?, title?, icon?, body?` | the parent is a non-archived page of the same space, otherwise `invalid_args`; with a parent `projectId` = the parent's, without - a project of this space or null, otherwise `invalid_args`; `title` defaults to `''`, `body` - `{type:'doc', content:[]}`; `text`, `files` from `body`; `createdBy = updatedBy = ctx.userId` |
| `docs.page.update` | `id, title?, icon?, body?` | archived -> `conflict`; `body` -> recompute `text`, `files`; `updatedBy = ctx.userId` |
| `docs.page.move` | `id, parentId, rank, projectId?, spaceId?` | `parentId: uuid \| null` (the key is required); `projectId` = the new parent's, at the root - `projectId` from args (no key - unchanged), a project of another space without explicit spaceId -> `invalid_args`; `spaceId` (PLNRAPP-5) — move to another space (root of the space or its project), descendants get the same `spaceId` and `projectId`; descendants get the same `projectId`; the page itself or its descendant -> `invalid_args`; another space without rights -> `forbidden`; the page or the new parent is archived -> `conflict` |
| `docs.page.archive` | `id` | `archivedAt = ctx.now`, `archivedBy = ctx.userId` on the page and all its non-archived descendants; already archived - nothing |
| `docs.page.restore` | `id` | admin of the page's project (of the space for a space page) / space / instance, otherwise `forbidden`; clears `archivedAt`, `archivedBy` on the page and the descendants with the same `archivedAt`; parent archived -> `parentId = null` |
| `docs.page.delete` | `id` | only an archived page (otherwise `conflict`); admin as in restore; deletes the page and its descendants with their links and locks. Used by the job `docs.archive.purge` (archived > 30 days) |
| `docs.link.add` | `id, pageId, taskId` | the task (a `tasks` row) and the page are in one space, otherwise `invalid_args`; pair already linked - nothing |
| `docs.link.remove` | `pageId, taskId` | no link - nothing |
| `docs.lock` | `pageId` | no lock, expired or own -> `put {id: pageId, spaceId of the page, userId: ctx.userId, expiresAt: ctx.now + 120 s}`; another's active lock -> `conflict` |
| `docs.unlock` | `pageId` | own -> delete; otherwise nothing |

There is no page deletion (archive only) - a shortcut until a user asks.

## DC-web v1 (CL-4)
- Route `/m/docs/:pageId` - a page; `/m/docs` - the last opened one or empty.
- The page tree is a sidebar point from WK-0 (C-modules v3, `docs/contracts/work.md`), per space; drag-and-drop = `docs.page.move`.
- Task panel `taskPanels`: `{id: 'pages'}` - linked pages, link/unlink.
- Cmd+K search - by `docsPages.title` and `text` of the local replica (the search point is X-core, after the gateway).
- Images - `POST /files`, node `image` with `src: '/files/<sha256>'`; reading the file by other members - X-core `canReadFile`.

## CH-schema v4

v4 (PLNRAPP-154): `chatChannels.archivedBy` - who archived.

v2 (groups): `chatChannels.projectId`.
v3: attachment += `durationMs?` (voice, `mime audio/*`).

Module `chat` (`modules/chat`, package `@planar/module-chat`), tables `chat_<snake>`. Space channels (`spaceId` set) are visible to all space members. Direct dialogs have `spaceId = null`, 2-8 participants (`chatMembers`), visible only to them: scope `space|members` (C-sync v2, §X-core item 1); every entity with this scope has `meta.members = {entity: 'chatMembers', key: 'channelId', container: 'chatChannels', via}` - `via: 'id'` for `chatChannels`, `'channelId'` for the rest. FKs inside the module have no cascade; there are no FKs to `users` and `spaces`.

#### chatChannels
scope: space|members · write: guest · bootstrap: yes · indexes: spaceId

| field | type | note |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid? | null - a direct dialog |
| `projectId` | uuid? | a project of the same space - a project channel; null - space level or a dialog |
| `kind` | enum(channel,dm) | `dm` <=> `spaceId = null` |
| `name` | text? | channel - 1-80 characters; null for a dialog (the UI shows participant names) |
| `topic` | text? | <= 250 |
| `createdBy` | uuid | |
| `lastSeq` | int | number of the last top-level message; 0 - none |
| `lastMessageAt` | ts? | |
| `archivedAt` | ts? | |
| `archivedBy` | uuid? | who archived; default null |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### chatMembers
scope: space|members · write: guest · bootstrap: yes · indexes: channelId, userId

| field | type | note |
|---|---|---|
| `id` | uuid | unique (channelId, userId); dialogs only |
| `channelId` | uuid | |
| `userId` | uuid | |
| `addedBy` | uuid | |
| `createdAt` | ts | |

#### chatMessages
scope: space|members · write: guest · bootstrap: no · indexes: channelId, parentId

| field | type | note |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid? | = the channel's |
| `channelId` | uuid | |
| `parentId` | uuid? | thread root (a top-level message of the same channel); one level |
| `seq` | int? | top level - the channel's `lastSeq + 1`; null for replies |
| `authorId` | uuid | = ctx.userId |
| `body` | doc | TipTap JSON, like `comments.body`; <= 64 KB as JSON |
| `mentions` | uuid[] | ids from mention nodes, without repeats, in order; only those who can see the channel |
| `attachments` | json | `{fileSha256, name, mime, size, width?, height?, durationMs?}[]`, <= 10; `fileSha256` - hex 64 |
| `replyCount` | int | on a root - the number of replies |
| `lastReplyAt` | ts? | |
| `editedAt` | ts? | |
| `deletedAt` | ts? | soft delete: `body` is an empty doc, `mentions` and `attachments` are empty |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### chatReactions
scope: space|members · write: guest · bootstrap: no · indexes: messageId

| field | type | note |
|---|---|---|
| `id` | uuid | unique (messageId, userId, emoji) |
| `spaceId` | uuid? | = the channel's |
| `channelId` | uuid | |
| `messageId` | uuid | |
| `userId` | uuid | = ctx.userId |
| `emoji` | text | 1-32 characters |
| `createdAt` | ts | |

#### chatReads
scope: user · write: self · bootstrap: yes · indexes: channelId

| field | type | note |
|---|---|---|
| `id` | uuid | unique (userId, channelId) |
| `userId` | uuid | |
| `channelId` | uuid | |
| `lastReadSeq` | int | unread = `chatChannels.lastSeq − lastReadSeq` (no row - 0) |
| `muted` | bool | no push and no counter in the sidebar |
| `updatedAt` | ts | |

## CH-mutators v5

v5 (PLNRAPP-154): `chat.channel.update` records `archivedBy`, out of the archive - admin only; `chat.channel.delete` - also an admin of the project / instance.

v4: `chat.dm.removeMember`.

v3: `chat.channel.delete`; `chat.reaction.toggle` += `removeId?`.
v2 (groups): `chat.channel.create` += `projectId?`.

Export - `shared.mutators` from `modules/chat/shared/index.ts`. All ids are in args. "Can see the channel": a space channel - a `spaceMembers` member; a dialog - a `chatMembers` row.

| name | args | rules |
|---|---|---|
| `chat.channel.create` | `id, spaceId, projectId?, name, topic?` | space role >= member, otherwise `forbidden`; a project not of this space -> `invalid_args`; `name` after trim 1-80, otherwise `invalid_args`; `kind = channel`, `lastSeq = 0` |
| `chat.channel.update` | `id, name?, topic?, archivedAt?` | only `kind = channel` (otherwise `invalid_args`); the creator or a space admin, otherwise `forbidden`; `archivedAt` set on a live channel -> `archivedBy = ctx.userId`; `archivedAt: null` on an archived one - admin of the project / space / instance (otherwise `forbidden`), clears `archivedBy` |
| `chat.channel.delete` | `id` | only `kind = channel`; the creator or an admin of the project / space / instance, otherwise `forbidden` (the job `chat.archive.purge` - archived > 30 days); deletes the channel's messages and reactions, own `chatReads` and the channel (other users' `chatReads` - self rows - remain) |
| `chat.dm.create` | `id, members: {id, userId}[]` | 2-8 rows, `userId` without repeats, ctx.userId among them, each has a `users` row without `deactivatedAt` - otherwise `invalid_args`; `spaceId = null`, `kind = dm`, `name = null`; the container first, then the participants (`addedBy = ctx.userId`). The UI does not create a second dialog with the same set of participants (it opens the existing one) |
| `chat.dm.addMember` | `id, channelId, userId` | dialog only; already a participant - nothing; would exceed 8 -> `conflict` |
| `chat.dm.removeMember` | `channelId, userId` | dialog only (`invalid_args`); only the dialog creator (`forbidden`); oneself - `invalid_args` (leaving - `chat.dm.leave`); not a participant - nothing; fewer than 2 would remain -> `conflict`; deletes the `chatMembers` row |
| `chat.dm.leave` | `channelId` | deletes own `chatMembers` row; none - nothing |
| `chat.message.send` | `id, channelId, body, readId, parentId?, attachments?` | channel archived -> `conflict`; `parentId` - a top-level message of the same channel, otherwise `invalid_args`; top level: `seq = lastSeq + 1`, the channel gets `lastSeq`, `lastMessageAt`; reply: `seq = null`, the root gets `replyCount + 1`, `lastReplyAt`; `mentions` from `body` (those who cannot see the channel are dropped); own `chatReads` (`id = readId`, if there is no row): `lastReadSeq = max(current, seq)` for the top level |
| `chat.message.update` | `id, body` | author only (`forbidden`); deleted -> `conflict`; `editedAt = ctx.now`, recompute `mentions` |
| `chat.message.delete` | `id` | author only; soft delete (`deletedAt`); deletes the message's reactions; the root's `replyCount` does not change |
| `chat.reaction.toggle` | `id, messageId, emoji, removeId?` | exists (messageId, ctx.userId, emoji) - delete, otherwise create; `removeId` - own reaction the client sees from REST history (on the client it is deleted by this id, the server finds it itself); deleted message -> `conflict` |
| `chat.read` | `id, channelId, lastReadSeq` | own `chatReads` (`id` - if there is no row): `lastReadSeq = min(max(current, args), channel lastSeq)` |
| `chat.mute` | `id, channelId, muted` | own `chatReads` (`id` - if there is no row) |

## CH-api v1

REST under `/api/chat/` (session or Bearer), channel not visible -> `404 not_found`; rows in the wire format.
- `GET /api/chat/channels/:id/messages?before=<seq>&limit=<1..100, default 50>` -> `{messages, reactions}`: top level with `seq < before` (without `before` - the latest), ascending by `seq`; `reactions` - for these messages.
- `GET /api/chat/messages/:id/thread` -> `{root, replies, reactions}`: replies by `createdAt`.
- `canReadFile` - §X-core item 4.
- Notifications - the `afterMutation` hook (`docs/contracts/work.md` §C-modules v3): `notifications` rows via `api.sys` (`taskId = null`, the channel's `spaceId`, `url`, `body` = "Author name: text", <= 140), push - `api.enqueue('push.notification', {notificationId})` for each (the core queue `apps/api/src/push/push.ts`). The recipient can see the channel, is not the author, has no `muted`, one notification per message in priority order: `chat_mention` (newly mentioned, on create and edit) -> `chat_dm` (participants of a 1:1 dialog; in a group of three or more - mentions only) -> `chat_reply` (the root's author and earlier reply authors of the thread, except dialogs). `url` - `/m/chat/c/<channelId>/<messageId>`; a reply - `/m/chat/c/<channelId>/t/<rootId>`.
- WS "typing..." - `sendTyping('chatChannels', channelId)` (§X-core item 2).

## CH-web v1 (CL-2)
- Routes: `/m/chat/` - the list (mobile) or the last channel, `/m/chat/c/:channelId/:messageId?`, `/m/chat/c/:channelId/t/:rootId` (thread: a panel on the right on desktop, a screen on mobile).
- Sidebar - `nav` with `section` (WK-0): space channels and dialogs, unread counters (`lastSeq − lastReadSeq`, without `muted`). On mobile `nav` is not shown - entry via `topbar` (a chat icon with a counter).

## X-core - core changes from collab (project, gateway)

Done by collab as a separate task **after** WK-0 (feature/work) is merged: the `afterMutation` hook, pg-boss in the transaction, web nav/topbar points - come from WK-0 and are not duplicated here.

1. **C-sync v2 - `space|members` visibility.** `EntityMeta` += `members?: {entity, key, container, via}` (for chat: `{entity:'chatMembers', key:'channelId', container:'chatChannels', via:'id'|'channelId'}`).
   - `row.spaceId` set -> as `space`. Otherwise the recipients are the `userId` of the `members.entity` rows with `key = row[via]` (state after the write, in the same transaction): one `changes` row per recipient, `user_id = recipient`, `space_id = null`. Pull and WS do not change.
   - A new `members.entity` row (participant added) -> the new participant additionally gets a `put` of the container and all `bootstrap: yes` rows of that container; deleted -> a `del` of the same rows. No `_reset` is written. Message history (`bootstrap: no`) - via REST.
   - Bootstrap: `spaceId ∈ my spaces` or (`spaceId` null and `row[via]` in my `key` values from `members.entity`).
   - Write (server `Tx`): `spaceId` set -> role >= the entity's `write`; otherwise `ctx.userId` is a participant of `row[via]` or the container's `createdBy` = `ctx.userId` (a new container - `row.createdBy = ctx.userId`). Checked against both the old and the new row.
   - Leak e2e: a third user receives no dialog rows in bootstrap, in pull, or any data over WS.
2. **WS "typing...".** Client -> `{t:'typing', entity, id}`; server - if the sender can see the row - broadcasts `{t:'typing', entity, id, userId}` to connected users who can see it, except the sender; at most once per 3 s per (sender, id). The client shows it for 5 s. C-client: `sendTyping(entity, id)`, `onTyping(cb) => unsubscribe`.
3. **Notifications.** `notifications`: `spaceId uuid?`, `taskId uuid?`, `kind` += `chat_mention, chat_dm, chat_reply`, new `url text?` (a path in the app), `body text?` (<= 140 characters: "Name: text"). Push (C-http "Web Push"): no `taskId` -> `url`, `body` from the notification; the `url` rules are unchanged. Inbox web shows such notifications by `body` and leads to `url`.
4. **Files.** `BackendModuleManifest.canReadFile?(q, userId, sha256): Promise<boolean>` - `GET /files/:sha256` is allowed if any enabled module returned `true`. chat - the file is in the `attachments` of a message in a channel visible to the user **and** `file_uploads(sha256, message authorId)` exists; docs - the file is in `docsPages.files` of a page of the user's space **and** `file_uploads(sha256, u)` exists for a member `u` of that space. Writes are not checked (the `afterMutation` hook cannot reject a mutation): someone else's sha256 without your own file upload does not open the file.
5. **Cmd+K search.** web: the extension point `search` - `{id, label, search(q: string, limit: number): Promise<{id, title, subtitle?, icon?, to: RouteLocationRaw}[]>}`; the palette shows module groups under tasks.
6. **Module SDK** (`@planar/web/modules`, `apps/web/src/modules/sdk.ts`; C-modules v5 on top of work's v4): += `Editor` (component `apps/web/src/task/editor/Editor.vue`, props as is), `uploadFile` (`apps/web/src/api/files.ts`), the JSON request HTTP helper `apps/web/src/api/http.ts` (same names), `sendTyping`, `onTyping`, `onMutationError` (C-client) - CL-6s; `useSearch` (task search, `apps/web/src/command/search.ts`) - CL-6b. Module tests (`*.test.ts`) may import `apps/web/src` by relative path to set up the client; module code - only the SDK; the rest of the SDK - as in `docs/contracts/work.md` §C-modules v4.
