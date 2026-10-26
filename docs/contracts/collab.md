---
type: reference
status: active
module: collab
updated: 2026-10-23
summary: Контракты collab — документы (DC-*), чат (CH-schema, CH-mutators, CH-api, CH-web), правки ядра для чата (X-core)
related: ["docs/plan/collab.md", "docs/contracts/core.md", "docs/contracts/core-mutators.md", "docs/contracts/web.md"]
---

# Контракты модуля collab

Владелец — координатор collab. Формат сущностей и мутаторов — как в `docs/contracts/core.md` (C-schema) и `core-mutators.md`; правила C-schema «Общие правила», «Типы», «Видимость и права» действуют. Контрактный тест — `apps/api/test/modules/collab.contract.test.ts`: сверяет разделы `#### <сущность>` и таблицы мутаторов этого файла с `shared.entities` и `shared.mutators` модулей (имена полей, nullability, meta, имена и необязательность args).

## DC-schema v2

v2 (группы): `docsPages.projectId` — уровень страницы.

Модуль `docs` (`modules/docs`, пакет `@planar/module-docs`), таблицы `docs_<snake>`. FK между сущностями модуля — без каскада; на `tasks` FK нет (ядро удаляет задачи, не зная о модуле): связь с удалённой задачей UI не показывает.

#### docsPages
scope: space · write: member · bootstrap: yes · indexes: spaceId, parentId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid | |
| `projectId` | uuid? | проект того же пространства; null — уровень пространства (у корневого — Воркспейс); у потомков — как у корня дерева |
| `parentId` | uuid? | страница того же пространства; null — корень |
| `rank` | rank | порядок среди соседей (один `parentId`) |
| `title` | text | 0–200 символов; пусто — UI пишет «Без названия» |
| `icon` | text? | эмодзи, 1–16 символов |
| `body` | doc | ProseMirror/TipTap JSON; ≤ 512 КБ в JSON |
| `text` | text | текст всех text-узлов `body` через пробел, обрезан до 100 000 символов; считает мутатор |
| `files` | json | `string[]` — sha256 (hex 64) из узлов `{type:'image', attrs:{src:'/files/<sha256>…'}}` `body`, без повторов, по порядку; считает мутатор |
| `createdBy` | uuid | |
| `updatedBy` | uuid | последний, кто менял `title`/`icon`/`body` |
| `archivedAt` | ts? | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

Инварианты: `parentId` не образует цикл; у неархивной страницы родитель неархивный.

#### docsTaskLinks
scope: space · write: member · bootstrap: yes · indexes: pageId, taskId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | уникально (pageId, taskId) |
| `spaceId` | uuid | |
| `pageId` | uuid | |
| `taskId` | uuid | задача того же пространства; без FK |
| `createdBy` | uuid | |
| `createdAt` | ts | |

#### docsLocks
scope: space · write: member · bootstrap: yes · indexes: —

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | = id страницы (одна блокировка на страницу) |
| `spaceId` | uuid | |
| `userId` | uuid | кто редактирует |
| `expiresAt` | ts | `ctx.now` + 120 с; клиент продлевает раз в 60 с, пока открыт редактор |

Мягкая блокировка: только индикатор «редактирует X» и режим чтения у остальных в UI; `docs.page.update` её не проверяет. Истёкшая (`expiresAt ≤ ctx.now`) считается отсутствующей. Шорткат: без совместного редактирования; понадобится — Yjs + Hocuspocus.

## DC-mutators v2

v2 (группы): `projectId` в `docs.page.create`/`docs.page.move`.

Экспорт — `shared.mutators` из `modules/docs/shared/index.ts`; `args` — `z.object`. Все id и `rank` — в args. Чужое пространство или нет строки — `not_found`/`forbidden` по общим правилам серверного `Tx`.

| имя | args | правила |
|---|---|---|
| `docs.page.create` | `id, spaceId, rank, projectId?, parentId?, title?, icon?, body?` | родитель — неархивная страница того же пространства, иначе `invalid_args`; с родителем `projectId` = родителя, без — проект этого пространства или null, иначе `invalid_args`; `title` по умолчанию `''`, `body` — `{type:'doc', content:[]}`; `text`, `files` из `body`; `createdBy = updatedBy = ctx.userId` |
| `docs.page.update` | `id, title?, icon?, body?` | архивная → `conflict`; `body` → пересчёт `text`, `files`; `updatedBy = ctx.userId` |
| `docs.page.move` | `id, parentId, rank, projectId?` | `parentId: uuid \| null` (ключ обязателен); `projectId` = нового родителя, в корне — `projectId` из args (нет ключа — прежний), проект чужого пространства → `invalid_args`; потомки получают тот же `projectId`; сама страница или её потомок → `invalid_args`; другое пространство → `invalid_args`; страница или новый родитель архивные → `conflict` |
| `docs.page.archive` | `id` | `archivedAt = ctx.now` у страницы и всех её неархивных потомков; уже архивная — ничего |
| `docs.page.restore` | `id` | снимает `archivedAt` у страницы и потомков с тем же `archivedAt`; родитель архивный → `parentId = null` |
| `docs.link.add` | `id, pageId, taskId` | задача (строка `tasks`) и страница одного пространства, иначе `invalid_args`; пара уже связана — ничего |
| `docs.link.remove` | `pageId, taskId` | нет связи — ничего |
| `docs.lock` | `pageId` | нет блокировки, истекла или своя → `put {id: pageId, spaceId страницы, userId: ctx.userId, expiresAt: ctx.now + 120 с}`; чужая действующая → `conflict` |
| `docs.unlock` | `pageId` | своя → удалить; иначе ничего |

Удаления страниц нет (только архив) — шорткат до запроса пользователя.

## DC-web v1 (CL-4)
- Маршрут `/m/docs/:pageId` — страница; `/m/docs` — последняя открытая или пусто.
- Дерево страниц — точка боковой панели из WK-0 (C-modules v3, `docs/contracts/work.md`), по пространствам; перетаскивание = `docs.page.move`.
- Панель задачи `taskPanels`: `{id: 'pages'}` — связанные страницы, связать/отвязать.
- Поиск Cmd+K — по `docsPages.title` и `text` локальной реплики (точка поиска — X-core, после шлюза).
- Изображения — `POST /files`, узел `image` с `src: '/files/<sha256>'`; чтение файла другими участниками — X-core `canReadFile`.

## CH-schema v2

v2 (группы): `chatChannels.projectId`.

Модуль `chat` (`modules/chat`, пакет `@planar/module-chat`), таблицы `chat_<snake>`. Каналы пространства (`spaceId` задан) видны всем участникам пространства. Личные диалоги — `spaceId = null`, 2–8 участников (`chatMembers`), видны только им: scope `space|members` (C-sync v2, §X-core п. 1), у всех сущностей с этим scope `meta.members = {entity: 'chatMembers', key: 'channelId', container: 'chatChannels', via}` — `via: 'id'` у `chatChannels`, `'channelId'` у остальных. FK внутри модуля — без каскада; на `users` и `spaces` FK нет.

#### chatChannels
scope: space|members · write: guest · bootstrap: yes · indexes: spaceId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid? | null — личный диалог |
| `projectId` | uuid? | проект того же пространства — канал проекта; null — уровень пространства или диалог |
| `kind` | enum(channel,dm) | `dm` ⇔ `spaceId = null` |
| `name` | text? | канал — 1–80 символов; у диалога null (UI — имена участников) |
| `topic` | text? | ≤ 250 |
| `createdBy` | uuid | |
| `lastSeq` | int | номер последнего сообщения верхнего уровня; 0 — нет |
| `lastMessageAt` | ts? | |
| `archivedAt` | ts? | |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### chatMembers
scope: space|members · write: guest · bootstrap: yes · indexes: channelId, userId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | уникально (channelId, userId); только диалоги |
| `channelId` | uuid | |
| `userId` | uuid | |
| `addedBy` | uuid | |
| `createdAt` | ts | |

#### chatMessages
scope: space|members · write: guest · bootstrap: no · indexes: channelId, parentId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | |
| `spaceId` | uuid? | = канала |
| `channelId` | uuid | |
| `parentId` | uuid? | корень треда (сообщение верхнего уровня того же канала); один уровень |
| `seq` | int? | верхний уровень — `lastSeq + 1` канала; у ответов null |
| `authorId` | uuid | = ctx.userId |
| `body` | doc | TipTap JSON, как `comments.body`; ≤ 64 КБ в JSON |
| `mentions` | uuid[] | id из узлов mention, без повторов, по порядку; только те, кто видит канал |
| `attachments` | json | `{fileSha256, name, mime, size, width?, height?}[]`, ≤ 10; `fileSha256` — hex 64 |
| `replyCount` | int | у корня — число ответов |
| `lastReplyAt` | ts? | |
| `editedAt` | ts? | |
| `deletedAt` | ts? | мягкое удаление: `body` пустой doc, `mentions` и `attachments` пусты |
| `createdAt` | ts | |
| `updatedAt` | ts | |

#### chatReactions
scope: space|members · write: guest · bootstrap: no · indexes: messageId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | уникально (messageId, userId, emoji) |
| `spaceId` | uuid? | = канала |
| `channelId` | uuid | |
| `messageId` | uuid | |
| `userId` | uuid | = ctx.userId |
| `emoji` | text | 1–32 символа |
| `createdAt` | ts | |

#### chatReads
scope: user · write: self · bootstrap: yes · indexes: channelId

| поле | тип | примечание |
|---|---|---|
| `id` | uuid | уникально (userId, channelId) |
| `userId` | uuid | |
| `channelId` | uuid | |
| `lastReadSeq` | int | непрочитано = `chatChannels.lastSeq − lastReadSeq` (нет строки — 0) |
| `muted` | bool | без push и счётчика в боковой панели |
| `updatedAt` | ts | |

## CH-mutators v3

v3: `chat.channel.delete`; `chat.reaction.toggle` += `removeId?`.
v2 (группы): `chat.channel.create` += `projectId?`.

Экспорт — `shared.mutators` из `modules/chat/shared/index.ts`. Все id — в args. «Видит канал»: канал пространства — участник `spaceMembers`; диалог — строка `chatMembers`.

| имя | args | правила |
|---|---|---|
| `chat.channel.create` | `id, spaceId, projectId?, name, topic?` | роль в пространстве ≥ member, иначе `forbidden`; проект не этого пространства → `invalid_args`; `name` после trim 1–80, иначе `invalid_args`; `kind = channel`, `lastSeq = 0` |
| `chat.channel.update` | `id, name?, topic?, archivedAt?` | только `kind = channel` (иначе `invalid_args`); создатель или admin пространства, иначе `forbidden` |
| `chat.channel.delete` | `id` | только `kind = channel`; создатель или admin пространства, иначе `forbidden`; удаляет сообщения и реакции канала, свою `chatReads` и канал (чужие `chatReads` — строки self — остаются) |
| `chat.dm.create` | `id, members: {id, userId}[]` | 2–8 строк, `userId` без повторов, среди них ctx.userId, у каждого есть строка `users` без `deactivatedAt` — иначе `invalid_args`; `spaceId = null`, `kind = dm`, `name = null`; сначала контейнер, затем участники (`addedBy = ctx.userId`). Повторный диалог с тем же составом UI не создаёт (открывает существующий) |
| `chat.dm.addMember` | `id, channelId, userId` | только диалог; уже участник — ничего; станет > 8 → `conflict` |
| `chat.dm.leave` | `channelId` | удаляет свою строку `chatMembers`; нет — ничего |
| `chat.message.send` | `id, channelId, body, readId, parentId?, attachments?` | канал архивный → `conflict`; `parentId` — сообщение верхнего уровня того же канала, иначе `invalid_args`; верхний уровень: `seq = lastSeq + 1`, у канала `lastSeq`, `lastMessageAt`; ответ: `seq = null`, у корня `replyCount + 1`, `lastReplyAt`; `mentions` из `body` (кто не видит канал — отбрасывается); своя `chatReads` (`id = readId`, если строки нет): `lastReadSeq = max(текущее, seq)` для верхнего уровня |
| `chat.message.update` | `id, body` | только автор (`forbidden`); удалённое → `conflict`; `editedAt = ctx.now`, `mentions` пересчитать |
| `chat.message.delete` | `id` | только автор; мягкое удаление (`deletedAt`); удаляет реакции сообщения; `replyCount` корня не меняется |
| `chat.reaction.toggle` | `id, messageId, emoji, removeId?` | есть (messageId, ctx.userId, emoji) — удалить, иначе создать; `removeId` — своя реакция, которую клиент видит из истории REST (на клиенте удаляется по нему, сервер находит сам); удалённое сообщение → `conflict` |
| `chat.read` | `id, channelId, lastReadSeq` | своя `chatReads` (`id` — если строки нет): `lastReadSeq = min(max(текущее, args), lastSeq канала)` |
| `chat.mute` | `id, channelId, muted` | своя `chatReads` (`id` — если строки нет) |

## CH-api v1

REST под `/api/chat/` (сессия или Bearer), канал не виден → `404 not_found`; строки — в формате провода.
- `GET /api/chat/channels/:id/messages?before=<seq>&limit=<1..100, по умолчанию 50>` → `{messages, reactions}`: верхний уровень с `seq < before` (без `before` — последние), по возрастанию `seq`; `reactions` — к этим сообщениям.
- `GET /api/chat/messages/:id/thread` → `{root, replies, reactions}`: ответы по `createdAt`.
- `canReadFile` — §X-core п. 4.
- Уведомления — хук `afterMutation` (`docs/contracts/work.md` §C-modules v3): строки `notifications` через `api.sys` (`taskId = null`, `spaceId` канала, `url`, `body` = «Имя автора: текст», ≤ 140), push — `api.enqueue('push.notification', {notificationId})` на каждое (очередь ядра `apps/api/src/push/push.ts`). Получатель видит канал, не автор, у него нет `muted`, по одному уведомлению на сообщение в порядке приоритета: `chat_mention` (новые упомянутые, при создании и правке) → `chat_dm` (участникам диалога) → `chat_reply` (автору корня и прежним авторам ответов треда, кроме диалогов). `url` — `/m/chat/c/<channelId>/<messageId>`; ответ — `/m/chat/c/<channelId>/t/<rootId>`.
- WS «печатает…» — `sendTyping('chatChannels', channelId)` (§X-core п. 2).

## CH-web v1 (CL-2)
- Маршруты: `/m/chat/` — список (mobile) или последний канал, `/m/chat/c/:channelId/:messageId?`, `/m/chat/c/:channelId/t/:rootId` (тред: панель справа на desktop, экран на mobile).
- Боковая панель — `nav` с `section` (WK-0): каналы пространств и диалоги, счётчики непрочитанных (`lastSeq − lastReadSeq`, без `muted`). На mobile `nav` не показывается — вход через `topbar` (иконка чата со счётчиком).

## X-core — правки ядра от collab (проект, шлюз)

Делает collab отдельной задачей **после** вливания WK-0 (feature/work): хук `afterMutation`, pg-boss в транзакции, точки web nav/topbar — из WK-0, здесь не дублируются.

1. **C-sync v2 — видимость `space|members`.** `EntityMeta` += `members?: {entity, key, container, via}` (для chat: `{entity:'chatMembers', key:'channelId', container:'chatChannels', via:'id'|'channelId'}`).
   - `row.spaceId` задан → как `space`. Иначе получатели — `userId` строк `members.entity` с `key = row[via]` (состояние после записи, в той же транзакции): по строке `changes` на каждого, `user_id = получатель`, `space_id = null`. Pull и WS не меняются.
   - Новая строка `members.entity` (участник добавлен) → новому участнику дополнительно `put` контейнера и всех `bootstrap: yes`-строк этого контейнера; удалена → ему `del` тех же строк. `_reset` не пишется. История сообщений (`bootstrap: no`) — через REST.
   - Bootstrap: `spaceId ∈ мои пространства` или (`spaceId` null и `row[via]` ∈ мои `key` из `members.entity`).
   - Запись (серверный `Tx`): `spaceId` задан → роль ≥ `write` сущности; иначе `ctx.userId` — участник `row[via]` или `createdBy` контейнера = `ctx.userId` (новый контейнер — `row.createdBy = ctx.userId`). Проверка — по старой и новой строке.
   - e2e на утечку: третий не получает строк диалога ни в bootstrap, ни в pull, ни данных по WS.
2. **WS «печатает…».** Клиент → `{t:'typing', entity, id}`; сервер — если отправитель видит строку — рассылает `{t:'typing', entity, id, userId}` подключённым, кто её видит, кроме отправителя; не чаще раза в 3 с на (отправитель, id). Клиент показывает 5 с. C-client: `sendTyping(entity, id)`, `onTyping(cb) => unsubscribe`.
3. **Уведомления.** `notifications`: `spaceId uuid?`, `taskId uuid?`, `kind` += `chat_mention, chat_dm, chat_reply`, новые `url text?` (путь в приложении), `body text?` (≤ 140 символов: «Имя: текст»). Push (C-http «Web Push»): нет `taskId` → `url`, `body` из уведомления; правила `url` прежние. Inbox web показывает такие уведомления по `body` и ведёт на `url`.
4. **Файлы.** `BackendModuleManifest.canReadFile?(q, userId, sha256): Promise<boolean>` — `GET /files/:sha256` разрешён, если `true` вернул любой включённый модуль. chat — файл во `attachments` сообщения видимого пользователю канала **и** есть `file_uploads(sha256, authorId сообщения)`; docs — файл в `docsPages.files` страницы пространства пользователя **и** есть `file_uploads(sha256, u)` для участника `u` этого пространства. Запись не проверяется (хук `afterMutation` не может отклонить мутацию): чужой sha256 без своей загрузки файла не открывает.
5. **Поиск Cmd+K.** web: точка расширения `search` — `{id, label, search(q: string, limit: number): Promise<{id, title, subtitle?, icon?, to: RouteLocationRaw}[]>}`; палитра показывает группы модулей под задачами.
6. **SDK модулей** (`@planar/web/modules`, `apps/web/src/modules/sdk.ts`; C-modules v5 поверх v4 work): += `Editor` (компонент `apps/web/src/task/editor/Editor.vue`, пропсы как есть), `uploadFile` (`apps/web/src/api/files.ts`), HTTP-хелпер JSON-запросов `apps/web/src/api/http.ts` (те же имена), `sendTyping`, `onTyping`, `onMutationError` (C-client) — CL-6s; `useSearch` (поиск задач, `apps/web/src/command/search.ts`) — CL-6b. Тесты модулей (`*.test.ts`) для настройки клиента могут импортировать `apps/web/src` относительным путём; код модуля — только SDK; остальное в SDK — как в `docs/contracts/work.md` §C-modules v4.
