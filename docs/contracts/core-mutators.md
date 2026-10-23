---
type: reference
status: active
module: core
updated: 2026-10-23
summary: Мутаторы домена C-mutators v3 — имена, args, правила; сверка с domainMutators — packages/shared/test/check-mutators.ts
related: ["docs/contracts/core.md"]
---

# Мутаторы домена (C-mutators, docs/contracts/core.md)

### Мутаторы домена v3 (CR-5, FT; web вызывает по имени)
Все id и `rank` — в args. `?` — необязательный аргумент (`.optional()`; `null` допустим там, где поле строки nullable). Экспорт — `domainMutators: MutatorDef[]` из `@planar/shared`; `args` — `z.object`. Сверка с таблицей — `packages/shared/test/check-mutators.ts`.

| имя | args | правила |
|---|---|---|
| `space.create` | `id, name, rank, memberId, statusIds: uuid[5]` | создаёт пространство, участника (ctx.userId, admin) и 5 статусов по категориям: Backlog, Todo, In Progress, Done, Cancelled |
| `space.update` | `id, name?, description?, color?, icon?, rank?` | |
| `space.delete` | `id` | есть проекты → `conflict`; удаляет статусы, метки, виды, участников |
| `member.add` | `id, spaceId, userId, role` | |
| `member.update` | `id, role` | последний admin → `conflict` |
| `member.remove` | `id` | последний admin → `conflict` |
| `project.create` | `id, spaceId, name, key, rank, description?, color?, icon?, leadId?` | |
| `project.update` | `id, name?, key?, description?, color?, icon?, leadId?, rank?, archivedAt?` | |
| `project.delete` | `id` | есть задачи → `conflict` |
| `status.create` | `id, spaceId, name, category, color, rank` | |
| `status.update` | `id, name?, category?, color?, rank?` | |
| `status.delete` | `id, replaceWith` | задачи переходят в `replaceWith` (того же пространства); последний статус → `conflict` |
| `label.create` | `id, spaceId, name, color` | |
| `label.update` | `id, name?, color?` | |
| `label.delete` | `id` | удаляет `taskLabels` метки |
| `task.create` | `id, projectId, statusId, title, rank, parentId?, description?, priority?, dueDate?, startDate?, assignees?: {id, userId}[], labels?: {id, labelId}[]` | `spaceId` — из проекта; `number = null`; `priority` по умолчанию 0; `fields = {}` |
| `task.update` | `id, title?, description?, statusId?, priority?, rank?, dueDate?, startDate?, projectId?, parentId?, fields?` | `completedAt` по категории статуса; `projectId` другого пространства → `invalid_args`; `parentId` — не сама задача и не её потомок; `fields` — полная замена, каждый ключ — поле проекта задачи, значение по типу (features.md §F-fields), иначе `invalid_args`; смена `projectId` без `fields` → `fields = {}` |
| `task.delete` | `id` | рекурсивно подзадачи; затем исполнители, наблюдатели, метки, чек-лист, вложения, реакции, комментарии; связи `taskLinks` с taskId или targetId = задача (у каждой удаляемой подзадачи тоже) |
| `task.assign` | `id, taskId, userId` | уже назначен — ничего |
| `task.unassign` | `taskId, userId` | |
| `task.watch` | `id, taskId` | userId = ctx.userId |
| `task.unwatch` | `taskId` | только себя |
| `task.addLabel` | `id, taskId, labelId` | метка того же пространства |
| `task.removeLabel` | `taskId, labelId` | |
| `task.setField` | `taskId, fieldId, value` | `value: unknown`; поле — проекта задачи, иначе `invalid_args`; `null` — убрать ключ; иначе значение по типу (features.md §F-fields), `user` — строка `users` есть; меняет один ключ `fields` (остальные не трогает) |
| `field.create` | `id, projectId, name, type, options?, rank` | `spaceId` — из проекта; `options` по типу (по умолчанию: `select` — `{choices: []}`, `money` — `{currency: 'RUB'}`, иначе `{}`), неверные → `invalid_args` |
| `field.update` | `id, name?, options?, rank?` | `type` не меняется; у `select` убранные `choices` — значения с ними удаляются из `fields` задач проекта |
| `field.delete` | `id` | удаляет ключ из `fields` всех задач проекта (scan `projectId`), затем определение |
| `link.create` | `id, taskId, targetId, kind` | `taskId = targetId` → `invalid_args`; задачи разных пространств или нет задачи → `invalid_args`; пара уже связана (в любом направлении, любым `kind`) → `conflict`; `spaceId` — из задачи, `createdBy = ctx.userId` |
| `link.delete` | `id` | нет строки — ничего |
| `checklist.add` | `id, taskId, text, rank` | |
| `checklist.update` | `id, text?, done?, rank?` | |
| `checklist.delete` | `id` | |
| `comment.create` | `id, taskId, body` | `authorId = ctx.userId`, `mentions` из `body` |
| `comment.update` | `id, body` | только автор; `editedAt = ctx.now` |
| `comment.delete` | `id` | только автор; удаляет вложения и реакции комментария |
| `reaction.toggle` | `id, commentId, emoji` | есть реакция (commentId, ctx.userId, emoji) — удалить, иначе создать с `id`; `spaceId` — из комментария |
| `attachment.create` | `id, taskId, commentId?, fileSha256, name, mime, size, width?, height?` | `uploadedBy = ctx.userId` |
| `attachment.delete` | `id` | |
| `notification.read` | `ids: uuid[]` | `readAt = ctx.now`, только свои |
| `notification.delete` | `ids: uuid[]` | только свои |
| `view.create` | `id, spaceId, personal: bool, name, layout, filter, config, rank` | `personal` → `userId = ctx.userId` |
| `view.update` | `id, name?, layout?, filter?, config?, rank?` | |
| `view.delete` | `id` | |
| `settings.set` | `id, value` | |

Вспомогательное (shared): `fieldValueSchema(def)`, `defaultFieldOptions(type)`, `fieldOptionsSchema(type)` (features.md §F-fields), `extractMentions(doc): string[]`, `textToDoc(text, users): doc` (абзацы, `@login` → mention; для REST и MCP).

