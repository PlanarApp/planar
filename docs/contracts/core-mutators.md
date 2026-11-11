---
type: reference
status: closed
module: core
updated: 2026-11-02
summary: Domain mutators of C-mutators v17 — names, args, rules; checked against domainMutators in packages/shared/test/check-mutators.ts
related: ["docs/contracts/core.md"]
---

# Domain mutators (C-mutators, docs/contracts/core.md)

### Domain mutators v4 ( CR-5, FT, design; web calls them by name)
All ids and `rank` are in args. `?` is an optional argument (`.optional()`; `null` is allowed where the row field is nullable). Export — `domainMutators: MutatorDef[]` from `@planar/shared`; `args` is a `z.object`. Check against the table — `packages/shared/test/check-mutators.ts`.

| name | args | rules |
|---|---|---|
| `space.create` | `id, name, rank, memberId` | creates the space and a member (ctx.userId, admin); no statuses (v11: statuses belong to projects, see `project.create`) |
| `project.create` | `id, spaceId, name, key, rank, description?, color?, icon?, leadId?, defaultAssigneeId?, statusIds?: uuid[5], statusNames?, copyFrom?: {projectId, statuses: {id, fromId}[], labels: {id, fromId}[]}, modules?: string[]` | v13: `modules` — data module ids enabled in the new project (default `[]`; a non-data id → `invalid_args`; on the server an id with `unavailable` ≠ null → `invalid_args`). `spaceId` = `settings.root_space` → `invalid_args` (v6); v11: with `copyFrom` — as `project.copyDictionaries` (the source in the same space), otherwise `statusIds` (required then) create 5 statuses by category, `statusNames` as below; neither → `invalid_args` |
| `project.copyDictionaries` | `projectId, fromProjectId, statuses: {id, fromId}[], labels: {id, fromId}[]` | v11: copies the listed statuses/labels of `fromProjectId` into `projectId` under the new client ids (rank, name, category, color kept); both projects in one space, else `invalid_args`; a target status/label with the same name (case-insensitive) is skipped; admin of the space for statuses |
| `space.update` | `id, name?, description?, color?, icon?, leadId?, rank?` | |
| `space.delete` | `id, withContent?` | the root one (`settings.root_space`) → `invalid_args`; there are projects and no `withContent` → `conflict`; with `withContent` — first the project tasks (as `task.delete`), fields and projects; deletes statuses, labels, views, members; the space's journal and notifications are deleted by the DB (FK on delete cascade) |
| `member.add` | `id, spaceId, userId, role` | |
| `member.update` | `id, role` | the last admin → `conflict` |
| `member.remove` | `id` | the last admin → `conflict`; v14: also deletes the user's `projectMembers` rows of this space |
| `project.update` | `id, name?, key?, description?, color?, icon?, leadId?, defaultAssigneeId?, rank?, archivedAt?` | |
| `project.delete` | `id` | there are tasks → `conflict`; deletes the project's `fieldDefs` and `projectMembers` |
| `project.setMembersMode` | `projectId, mode, members?: {id, userId, role}[]` | v14: `custom` — `members` required and non-empty, every `userId` a space member (a space guest — role `guest` only), else `invalid_args`; the rows are created/updated/deleted to match; `inherit` — deletes the rows; idempotent; admin of the space or instance admin, else `forbidden` (docs/contracts/projects.md §PJ-11) |
| `projectMember.add` | `id, projectId, userId, role` | v14: only while the project is `custom` (else `conflict`); the user is a space member (guest cap), not yet in the project (`conflict`) |
| `projectMember.setRole` | `id, role` | v14: only while `custom` (else `conflict`); guest cap |
| `projectMember.remove` | `id` | v14: only while `custom` (else `conflict`) |
| `status.create` | `id, projectId, name, category, color, rank` | `spaceId` — from the project (v11) |
| `status.update` | `id, name?, category?, color?, rank?` | |
| `status.delete` | `id, replaceWith` | tasks move to `replaceWith` (of the same project, v11); the last status of the project → `conflict` |
| `label.create` | `id, projectId, name, color` | `spaceId` — from the project (v11) |
| `label.update` | `id, name?, color?` | |
| `label.delete` | `id` | deletes the label's `taskLabels` |
| `task.create` | `id, projectId, statusId, title, rank, parentId?, description?, priority?, dueDate?, startDate?, assignees?: {id, userId}[], labels?: {id, labelId}[]` | `spaceId` — from the project; `number = null`; `priority` defaults to 0; `fields = {}`; `cycleId = null`; v15: no `assignees` (or empty) and the project has `defaultAssigneeId` — that user is assigned, the `taskAssignees` row id = the task id |
| `task.update` | `id, title?, description?, statusId?, priority?, rank?, dueDate?, startDate?, projectId?, parentId?, fields?` | `completedAt` by the status category; `projectId` of another space (PLNRAPP-152) — the task with all its subtasks moves there with the same ids: subtasks first, status and labels remapped as below, `number`/`cycleId` reset, `fields = {}` (`fields` in the args → `invalid_args`), assignees and watchers not in the new space removed, `parentId` — the given one (of the new space) or `null`; the server moves the tied rows (core.md); `parentId` — neither the task itself nor its descendant; `fields` — full replacement, each key is a field of the task's project, the value by type (features.md §F-fields), otherwise `invalid_args`; a `projectId` change without `fields` → `fields = {}`; a `projectId` change → `cycleId = null`; a `projectId` change within the space takes all subtasks there too (status and labels remapped, `number`/`cycleId` reset, `fields = {}`; a subtask already in that project is untouched); does not accept `cycleId` (work.md §C-schema v7) |
| `task.delete` | `id` | subtasks recursively; then assignees, watchers, labels, checklist, attachments, reactions, comments; `taskLinks` links with taskId or targetId = the task (for each deleted subtask too) |
| `task.merge` | `id, targetId, linkId` | PLNRAPP-117: task `id` merges into `targetId` — the same space, not the task itself and not its descendant (`invalid_args`); comments, attachments, subtasks (`parentId`), assignees and watchers (a user already on the target — the row is deleted) move to the target; links of the task move to the target, a link with the target itself or with a task already linked to it is deleted; the task gets the first by rank `cancelled` status of its project (none → `invalid_args`) and the link `linkId`: `duplicates` the target; module rows (time entries) — in the module's `afterMutation` |
| `task.assign` | `id, taskId, userId` | already assigned — nothing |
| `task.unassign` | `taskId, userId` | |
| `task.watch` | `id, taskId` | userId = ctx.userId |
| `task.unwatch` | `taskId` | only oneself |
| `task.addLabel` | `id, taskId, labelId` | a label of the task's project (v11) |
| `task.removeLabel` | `taskId, labelId` | |
| `task.setField` | `taskId, fieldId, value` | `value: unknown`; the field belongs to the task's project, otherwise `invalid_args`; `null` — remove the key; otherwise the value by type (features.md §F-fields), for `user` the `users` row must exist; changes one key of `fields` (leaves the others alone) |
| `field.create` | `id, projectId, name, type, options?, rank` | `spaceId` — from the project; `options` by type (defaults: `select` — `{choices: []}`, `money` — `{currency: 'RUB'}`, otherwise `{}`), invalid ones → `invalid_args` |
| `field.update` | `id, name?, options?, rank?` | `type` does not change; for `select`, removed `choices` — values with them are deleted from the `fields` of the project's tasks |
| `field.delete` | `id` | deletes the key from `fields` of all tasks of the project (scan `projectId`), then the definition |
| `link.create` | `id, taskId, targetId, kind` | `taskId = targetId` → `invalid_args`; tasks of different spaces or a missing task → `invalid_args`; the pair is already linked (in any direction, with any `kind`) → `conflict`; `spaceId` — from the task, `createdBy = ctx.userId` |
| `link.delete` | `id` | no row — nothing |
| `checklist.add` | `id, taskId, text, rank, indent?` | `indent` 0–4, default 0 (v20) |
| `checklist.update` | `id, text?, done?, rank?, assigneeId?: uuid \| null, linkedTaskId?: uuid \| null, indent?` | `assigneeId` — a space member who is not a guest, otherwise `invalid_args` (v18); `linkedTaskId` — a task of the same space, otherwise `invalid_args` (v19) |
| `checklist.delete` | `id` | |
| `comment.create` | `id, taskId, body, parentId?, assigneeId?` | `authorId = ctx.userId`, `mentions` from `body`; `parentId` — any comment of this task (replies of any depth, PLANARAPP-45; another task → `invalid_args`); `assigneeId` — on a comment of any depth (PLNRAPP-135), a space member who is not a guest, otherwise `invalid_args` |
| `comment.update` | `id, body` | author only; `editedAt = ctx.now` |
| `comment.delete` | `id` | author only; deletes the comment with its whole subtree of replies, their attachments and reactions |
| `comment.assign` | `id, assigneeId: uuid \| null` | any comment, replies too (PLNRAPP-135); role ≥ member, otherwise `forbidden`; resets `resolvedAt/resolvedBy` |
| `comment.resolve` | `id, resolved` | assigned comment only; the assignee, the author or a space admin, otherwise `forbidden`; `resolvedAt/resolvedBy` = `ctx.now/ctx.userId` or null |
| `reaction.toggle` | `id, commentId, emoji` | a reaction (commentId, ctx.userId, emoji) exists — delete it, otherwise create it with `id`; `spaceId` — from the comment |
| `attachment.create` | `id, taskId, commentId?, fileSha256, name, mime, size, width?, height?` | `uploadedBy = ctx.userId` |
| `attachment.delete` | `id` | |
| `notification.read` | `ids: uuid[]` | `readAt = ctx.now`, own only |
| `notification.delete` | `ids: uuid[]` | own only |
| `day.plan` | `id, taskId, date, rank` | v16: `dayPlans` row of ctx.userId; the task is missing → `not_found`; the task already planned by the user for `date` — nothing |
| `day.move` | `id, date?, rank?` | v16: own only (else `forbidden`) — another day and/or place in the day |
| `day.remove` | `id` | v16: own only (else `forbidden`) |
| `favorite.add` | `id, kind, refId, name, url, rank` | v17: `favorites` row of ctx.userId; (`kind`, `refId`) already in the user's favourites — nothing |
| `favorite.move` | `id, rank` | v17: own only (else `forbidden`) |
| `favorite.remove` | `id` | v17: own only (else `forbidden`) |
| `view.create` | `id, spaceId, personal: bool, name, icon?, layout, node?, filter, config, rank` | `personal` → `userId = ctx.userId`; `node` set → always personal (a shared node default — only `view.setNodeDefault`) |
| `view.update` | `id, name?, icon?, layout?, filter?, config?, rank?` | |
| `view.delete` | `id` | |
| `view.setNodeDefault` | `id, spaceId, node, layout, filter, config` | v12: sets the shared default (`userId` null) of the built-in tab `layout` in `node`: deletes the existing shared row of that node+layout, puts the new one with `id`, and deletes the caller's own personal row of that node+layout; role member or above of the space (guest → `forbidden`) |
| `project.setModule` | `projectId, moduleId, enabled` | v12: adds/removes `moduleId` in `projects.modules`; the module is installed and a data module (shared ones → `invalid_args`); enabling needs `unavailable` = null (server only); admin of the project's space or instance admin, else `forbidden`; idempotent |
| `settings.set` | `id, value` | v12: `enabled_modules` holds only shared modules (chat, email, plugins, import, webhooks), a data module id in it → `invalid_args`. v5: `id = 'enabled_modules'` — the id of a module that was not among the enabled ones, with `unavailable` ≠ null (C-modules v11) → `invalid_args`; checked on the server only |

v11 rules (details — docs/contracts/projects.md): `statusNames` of `project.create` — as `space.create` before v11 (keys-categories `backlog`/`todo`/`in_progress`/`done`/`cancelled`, string 1–64 after trim, defaults Backlog, Todo, In Progress, Done, Cancelled). `task.create`: `statusId` and `labels[].labelId` must belong to `projectId`, otherwise `invalid_args`. `task.update`: `statusId` of the task's (new) project; on a `projectId` change the status and labels are remapped (projects.md §PJ-1 rules).

Helpers (shared): `fieldValueSchema(def)`, `defaultFieldOptions(type)`, `fieldOptionsSchema(type)` (features.md §F-fields), `extractMentions(doc): string[]`, `textToDoc(text, users): doc` (paragraphs, `@login` → mention; for REST and MCP).

