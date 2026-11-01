---
type: reference
status: active
module: core
updated: 2026-11-01
summary: Domain mutators of C-mutators v10 — names, args, rules; checked against domainMutators in packages/shared/test/check-mutators.ts
related: ["docs/contracts/core.md"]
---

# Domain mutators (C-mutators, docs/contracts/core.md)

### Domain mutators v4 ( CR-5, FT, design; web calls them by name)
All ids and `rank` are in args. `?` is an optional argument (`.optional()`; `null` is allowed where the row field is nullable). Export — `domainMutators: MutatorDef[]` from `@planar/shared`; `args` is a `z.object`. Check against the table — `packages/shared/test/check-mutators.ts`.

| name | args | rules |
|---|---|---|
| `space.create` | `id, name, rank, memberId, statusIds: uuid[5], statusNames?` | creates the space, a member (ctx.userId, admin) and 5 statuses by category; `statusNames` is an object with optional keys-categories `backlog`/`todo`/`in_progress`/`done`/`cancelled` and string values; the status name is `statusNames[category]` (a string of 1–64 characters after trim), otherwise the defaults: Backlog, Todo, In Progress, Done, Cancelled (v4: `statusNames`; the client passes names from the i18n of the current locale; existing spaces are not renamed) |
| `space.update` | `id, name?, description?, color?, icon?, rank?` | |
| `space.delete` | `id, withContent?` | the root one (`settings.root_space`) → `invalid_args`; there are projects and no `withContent` → `conflict`; with `withContent` — first the project tasks (as `task.delete`), fields and projects; deletes statuses, labels, views, members; the space's journal and notifications are deleted by the DB (FK on delete cascade) |
| `member.add` | `id, spaceId, userId, role` | |
| `member.update` | `id, role` | the last admin → `conflict` |
| `member.remove` | `id` | the last admin → `conflict` |
| `project.create` | `id, spaceId, name, key, rank, description?, color?, icon?, leadId?` | `spaceId` = `settings.root_space` → `invalid_args` (v6) |
| `project.update` | `id, name?, key?, description?, color?, icon?, leadId?, rank?, archivedAt?` | |
| `project.delete` | `id` | there are tasks → `conflict`; deletes the project's `fieldDefs` |
| `status.create` | `id, spaceId, name, category, color, rank` | |
| `status.update` | `id, name?, category?, color?, rank?` | |
| `status.delete` | `id, replaceWith` | tasks move to `replaceWith` (of the same space); the last status → `conflict` |
| `label.create` | `id, spaceId, name, color` | |
| `label.update` | `id, name?, color?` | |
| `label.delete` | `id` | deletes the label's `taskLabels` |
| `task.create` | `id, projectId, statusId, title, rank, parentId?, description?, priority?, dueDate?, startDate?, assignees?: {id, userId}[], labels?: {id, labelId}[]` | `spaceId` — from the project; `number = null`; `priority` defaults to 0; `fields = {}`; `cycleId = null` |
| `task.update` | `id, title?, description?, statusId?, priority?, rank?, dueDate?, startDate?, projectId?, parentId?, fields?` | `completedAt` by the status category; `projectId` of another space → `invalid_args`; `parentId` — neither the task itself nor its descendant; `fields` — full replacement, each key is a field of the task's project, the value by type (features.md §F-fields), otherwise `invalid_args`; a `projectId` change without `fields` → `fields = {}`; a `projectId` change → `cycleId = null`; does not accept `cycleId` (work.md §C-schema v7) |
| `task.delete` | `id` | subtasks recursively; then assignees, watchers, labels, checklist, attachments, reactions, comments; `taskLinks` links with taskId or targetId = the task (for each deleted subtask too) |
| `task.assign` | `id, taskId, userId` | already assigned — nothing |
| `task.unassign` | `taskId, userId` | |
| `task.watch` | `id, taskId` | userId = ctx.userId |
| `task.unwatch` | `taskId` | only oneself |
| `task.addLabel` | `id, taskId, labelId` | a label of the same space |
| `task.removeLabel` | `taskId, labelId` | |
| `task.setField` | `taskId, fieldId, value` | `value: unknown`; the field belongs to the task's project, otherwise `invalid_args`; `null` — remove the key; otherwise the value by type (features.md §F-fields), for `user` the `users` row must exist; changes one key of `fields` (leaves the others alone) |
| `field.create` | `id, projectId, name, type, options?, rank` | `spaceId` — from the project; `options` by type (defaults: `select` — `{choices: []}`, `money` — `{currency: 'RUB'}`, otherwise `{}`), invalid ones → `invalid_args` |
| `field.update` | `id, name?, options?, rank?` | `type` does not change; for `select`, removed `choices` — values with them are deleted from the `fields` of the project's tasks |
| `field.delete` | `id` | deletes the key from `fields` of all tasks of the project (scan `projectId`), then the definition |
| `link.create` | `id, taskId, targetId, kind` | `taskId = targetId` → `invalid_args`; tasks of different spaces or a missing task → `invalid_args`; the pair is already linked (in any direction, with any `kind`) → `conflict`; `spaceId` — from the task, `createdBy = ctx.userId` |
| `link.delete` | `id` | no row — nothing |
| `checklist.add` | `id, taskId, text, rank` | |
| `checklist.update` | `id, text?, done?, rank?` | |
| `checklist.delete` | `id` | |
| `comment.create` | `id, taskId, body, parentId?, assigneeId?` | `authorId = ctx.userId`, `mentions` from `body`; `parentId` — the root of a thread of this task (a reply to a reply → `invalid_args`); `assigneeId` — only for a root, a space member who is not a guest, otherwise `invalid_args` |
| `comment.update` | `id, body` | author only; `editedAt = ctx.now` |
| `comment.delete` | `id` | author only; deletes the comment's attachments and reactions, for a root — the whole thread too |
| `comment.assign` | `id, assigneeId: uuid \| null` | root only (otherwise `invalid_args`); role ≥ member, otherwise `forbidden`; resets `resolvedAt/resolvedBy` |
| `comment.resolve` | `id, resolved` | assigned root only; the assignee, the author or a space admin, otherwise `forbidden`; `resolvedAt/resolvedBy` = `ctx.now/ctx.userId` or null |
| `reaction.toggle` | `id, commentId, emoji` | a reaction (commentId, ctx.userId, emoji) exists — delete it, otherwise create it with `id`; `spaceId` — from the comment |
| `attachment.create` | `id, taskId, commentId?, fileSha256, name, mime, size, width?, height?` | `uploadedBy = ctx.userId` |
| `attachment.delete` | `id` | |
| `notification.read` | `ids: uuid[]` | `readAt = ctx.now`, own only |
| `notification.delete` | `ids: uuid[]` | own only |
| `view.create` | `id, spaceId, personal: bool, name, icon?, layout, node?, filter, config, rank` | `personal` → `userId = ctx.userId`; `node` set → always personal |
| `view.update` | `id, name?, icon?, layout?, filter?, config?, rank?` | |
| `view.delete` | `id` | |
| `settings.set` | `id, value` | v5: `id = 'enabled_modules'` — the id of a module that was not among the enabled ones, with `unavailable` ≠ null (C-modules v11) → `invalid_args`; checked on the server only |

Helpers (shared): `fieldValueSchema(def)`, `defaultFieldOptions(type)`, `fieldOptionsSchema(type)` (features.md §F-fields), `extractMentions(doc): string[]`, `textToDoc(text, users): doc` (paragraphs, `@login` → mention; for REST and MCP).

