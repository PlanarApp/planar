---
type: reference
status: active
module: core
updated: 2026-10-24
summary: Сущности C-schema v8 — таблицы, поля, nullability, scope/write/bootstrap/indexes; проверяет контрактный тест
related: ["docs/contracts/core.md"]
---

# Сущности C-schema v8

Часть контракта `C-schema v8` из `docs/contracts/core.md`. Раздел читает контрактный тест (`packages/shared/test/contract-doc.ts` → `docEntities`); версия — в заголовке `## C-schema vN` в core.md.

## Сущности

#### users
scope: global · write: server · bootstrap: yes · indexes: login

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `login` | text | уникален, в нижнем регистре |
| `name` | text | |
| `email` | text? | |
| `role` | enum(owner,admin,member,guest) | роль в инстансе; owner — первый пользователь |
| `avatarFile` | text? | sha256 файла |
| `deactivatedAt` | ts? | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

Только в БД: `password_hash text` (argon2id). В провод не попадает никогда.

#### spaces
scope: space · write: admin · bootstrap: yes · indexes: —

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | он же spaceId для видимости |
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

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | уникально (spaceId, userId) |
| `spaceId` | uuid | |
| `userId` | uuid | |
| `role` | enum(admin,member,guest) | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### projects
scope: space · write: member · bootstrap: yes · indexes: spaceId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `name` | text | 1–100 |
| `key` | text | `^[A-Z][A-Z0-9]{1,9}$`, уникален в инстансе (нарушение → `conflict`) |
| `description` | doc? | |
| `color` | text? | |
| `icon` | text? | |
| `leadId` | uuid? | |
| `rank` | rank | |
| `archivedAt` | ts? | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

Только в БД: `task_counter integer not null default 0`.

#### statuses
scope: space · write: admin · bootstrap: yes · indexes: spaceId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `name` | text | |
| `category` | enum(backlog,todo,in_progress,done,cancelled) | |
| `color` | text | |
| `rank` | rank | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### tasks
scope: space · write: member · bootstrap: yes · indexes: spaceId, projectId, parentId, statusId, cycleId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | = `projects.spaceId` |
| `projectId` | uuid | только проект того же пространства |
| `number` | int? | null у клиента до ответа сервера; ключ задачи = `${project.key}-${number}`; уникально (projectId, number) |
| `parentId` | uuid? | подзадача |
| `statusId` | uuid | статус того же пространства |
| `title` | text | 1–500 |
| `description` | doc? | |
| `priority` | int | 0 нет, 1 срочно, 2 высокий, 3 средний, 4 низкий |
| `rank` | rank | ручной порядок |
| `dueDate` | date? | |
| `startDate` | date? | |
| `createdBy` | uuid | |
| `completedAt` | ts? | ставит мутатор при переходе в категорию done/cancelled, снимает при выходе |
| `fields` | obj | `{<fieldDefs.id>: значение}` — поля проекта задачи, без `null`; формат — features.md §F-fields; по умолчанию `{}` |
| `cycleId` | uuid? | цикл sprints, без FK (work.md) |
| `createdAt` | ts | |
| `updatedAt` | ts | |

Сервер: запись `tasks` с `number = null` получает `number = ++projects.task_counter` (в той же транзакции). Смена `projectId` — мутатор ставит `number = null`.

#### taskAssignees
scope: space · write: member · bootstrap: yes · indexes: taskId, userId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | уникально (taskId, userId) |
| `spaceId` | uuid | |
| `taskId` | uuid | |
| `userId` | uuid | |
| `createdAt` | ts | |

#### taskWatchers
scope: space · write: guest · bootstrap: yes · indexes: taskId, userId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | уникально (taskId, userId); мутаторы добавляют и снимают только себя |
| `spaceId` | uuid | |
| `taskId` | uuid | |
| `userId` | uuid | |
| `createdAt` | ts | |

#### labels
scope: space · write: member · bootstrap: yes · indexes: spaceId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `name` | text | |
| `color` | text | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### taskLabels
scope: space · write: member · bootstrap: yes · indexes: taskId, labelId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | уникально (taskId, labelId) |
| `spaceId` | uuid | |
| `taskId` | uuid | |
| `labelId` | uuid | |
| `createdAt` | ts | |

#### fieldDefs
scope: space · write: member · bootstrap: yes · indexes: spaceId, projectId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | ключ значения в `tasks.fields` |
| `spaceId` | uuid | = `projects.spaceId` |
| `projectId` | uuid | поле принадлежит проекту |
| `name` | text | 1–100 |
| `type` | enum(text,number,date,select,user,url,money) | неизменяем после создания |
| `options` | obj | по типу (features.md §F-fields) |
| `rank` | rank | порядок полей в карточке и колонок по умолчанию |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### taskLinks
scope: space · write: member · bootstrap: yes · indexes: taskId, targetId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | одна строка на пару: уникальный индекс по least/greatest от taskId, targetId → `conflict` |
| `spaceId` | uuid | обе задачи — этого пространства |
| `taskId` | uuid | `blocks`: taskId блокирует targetId; `duplicates`: taskId — дубликат |
| `targetId` | uuid | ≠ `taskId` |
| `kind` | enum(blocks,relates,duplicates) | обратная сторона — features.md §F-links |
| `createdBy` | uuid | = ctx.userId |
| `createdAt` | ts | |

#### checklistItems
scope: space · write: member · bootstrap: yes · indexes: taskId

| поле | тип | примечание |
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

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `taskId` | uuid | |
| `authorId` | uuid | = ctx.userId; правит и удаляет только автор |
| `body` | doc | упоминание — узел `{type:'mention', attrs:{id:<userId>}}` |
| `mentions` | uuid[] | id из узлов mention, без повторов, по порядку появления |
| `editedAt` | ts? | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### commentReactions
scope: space · write: guest · bootstrap: yes · indexes: commentId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | уникально (commentId, userId, emoji) |
| `spaceId` | uuid | |
| `commentId` | uuid | |
| `userId` | uuid | = ctx.userId; мутатор ставит и снимает только свои |
| `emoji` | text | 1–32 символа (один эмодзи или короткий код) |
| `createdAt` | ts | |

#### attachments
scope: space · write: member · bootstrap: yes · indexes: taskId, commentId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `taskId` | uuid | |
| `commentId` | uuid? | |
| `fileSha256` | text | hex, 64 символа; файл должен быть в `files` |
| `name` | text | имя для скачивания |
| `mime` | text | |
| `size` | int | байты |
| `width` | int? | для картинок |
| `height` | int? | |
| `uploadedBy` | uuid | |
| `createdAt` | ts | |

Сервер: `put` разрешён, только если есть строка `file_uploads(fileSha256, ctx.userId)` или файл уже приложен в этом пространстве; иначе `forbidden`.

#### activity
scope: space · write: server · bootstrap: no · indexes: taskId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `taskId` | uuid | без FK |
| `actorId` | uuid | |
| `viaTokenId` | uuid? | id API-токена, если запись сделана через токен (CR-10), иначе null |
| `kind` | enum(created,updated,deleted,assignee_added,assignee_removed,label_added,label_removed,commented) | |
| `changes` | obj | `updated`: `{<поле>: [старое, новое]}` без `updatedAt`, `rank`; `assignee_*`: `{userId}`; `label_*`: `{labelId}`; `commented`: `{commentId}`; иначе `{}` |
| `createdAt` | ts | |

Пишет серверный `Tx` при записи `tasks`, `taskAssignees`, `taskLabels`, `comments` (создание). История — `GET /api/tasks/:id/activity` (C-http).

#### notifications
scope: user · write: self · bootstrap: yes · indexes: taskId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `userId` | uuid | получатель |
| `spaceId` | uuid? | для группировки; на видимость не влияет; null — личный диалог чата |
| `kind` | enum(assigned,mentioned,commented,status_changed,chat_mention,chat_dm,chat_reply) | `chat_*` создаёт модуль chat (collab.md §CH) |
| `taskId` | uuid? | без FK; null — у `chat_*` |
| `url` | text? | путь в приложении для уведомлений без задачи (правила `url` из «Web Push») |
| `body` | text? | ≤ 140 символов, «Имя: текст»; для уведомлений без задачи |
| `commentId` | uuid? | без FK |
| `actorId` | uuid | |
| `readAt` | ts? | |
| `createdAt` | ts | |

Создаёт сервер (CR-7) через серверный `Tx` от имени системы; пользователь мутаторами только читает (`readAt`) и удаляет свои. В bootstrap — последние 200 по `createdAt`.

Триггеры (серверный хук в транзакции мутации, после `run`; автор действия себя не уведомляет; получатель должен быть участником пространства):
- `assigned` — новому исполнителю (`taskAssignees` put);
- `mentioned` — каждому из `comments.mentions` (создание и правка — только новым упомянутым);
- `commented` — наблюдателям задачи при новом комментарии, кроме упомянутых в нём;
- `status_changed` — наблюдателям при смене `tasks.statusId`.

Автоподписка (тот же хук, `taskWatchers` от имени системы): автор задачи, назначенный исполнитель, автор комментария. Push — задача pg-boss на каждое уведомление после коммита.

#### savedViews
scope: space|user · write: member|self · bootstrap: yes · indexes: spaceId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `userId` | uuid? | не null — личный вид (видит только владелец), null — общий для пространства |
| `createdBy` | uuid | |
| `name` | text | |
| `layout` | text | `list`, `board` или id вида модуля |
| `filter` | obj | |
| `config` | obj | группировка, сортировка, колонки |
| `rank` | rank | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### settings
scope: global · write: instance_admin · bootstrap: yes · indexes: —

| поле | тип | примечание |
|---|---|---|
| `id` | text | ключ |
| `value` | json | |
| `updatedAt` | ts | |

Ключи v1: `enabled_modules` — `string[]` id модулей. Секреты (VAPID и т. п.) в `settings` не кладём — только env.
